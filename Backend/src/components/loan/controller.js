const Loan = require('./model')
const Account = require('../account/model')
const Statement = require('../monthlyStatement/model')
const SavingsMovement = require('../savingsMovement/model')
const myError = require('../../libs/myError')
const log = require('../../libs/activityLog')

async function ensureSavingsAccount(userId) {
    let acc = await Account.findOne({ userId, type: 'savings' })
    if (!acc) {
        const accountController = require('../account/controller')
        await accountController.bootstrap(userId)
        acc = await Account.findOne({ userId, type: 'savings' })
    }
    return acc
}

function enrichLoan(loan, stmtMap) {
    const obj = loan.toObject ? loan.toObject() : loan
    return {
        ...obj,
        originStatement: stmtMap.get(String(obj.originStatementId)) || null,
        currentStatement: stmtMap.get(String(obj.currentStatementId)) || null
    }
}

async function buildStmtMap(loans) {
    const ids = [...new Set(loans.flatMap(l => [String(l.originStatementId), String(l.currentStatementId)]))]
    const stmts = await Statement.find({ _id: { $in: ids } }, 'year month').lean()
    return new Map(stmts.map(s => [String(s._id), { year: s.year, month: s.month }]))
}

async function list(userId) {
    const loans = await Loan.find({ userId }).sort({ createdAt: -1 })
    if (!loans.length) return []
    const stmtMap = await buildStmtMap(loans)
    return loans.map(l => enrichLoan(l, stmtMap))
}

async function listForStatement(userId, statementId) {
    const loans = await Loan.find({ userId, currentStatementId: statementId }).sort({ createdAt: -1 })
    if (!loans.length) return []
    const stmtMap = await buildStmtMap(loans)
    return loans.map(l => enrichLoan(l, stmtMap))
}

async function getPendingTotal(userId, statementId) {
    // Include 'transferred' (!fromSavings, !fromCard) so savings withdrawal compensates correctly.
    // Exclude fromSavings/fromCard loans: savings or card already covered them.
    const loans = await Loan.find({ userId, currentStatementId: statementId, status: { $in: ['pending', 'transferred'] }, fromSavings: { $ne: true }, fromCard: { $ne: true } })
    return loans.reduce((s, l) => s + (l.amount - (l.paidAmount || 0)), 0)
}

async function create(userId, { borrowerName, amount, lentDate, statementId }) {
    const stmt = await Statement.findOne({ _id: statementId, userId })
    if (!stmt) throw myError('Mes no encontrado', 404)

    const loan = await Loan.create({
        userId,
        borrowerName,
        amount,
        lentDate: new Date(lentDate),
        originStatementId: statementId,
        currentStatementId: statementId,
        status: 'pending',
        history: [{ type: 'lent', date: new Date() }]
    })

    await log(userId, stmt.year, stmt.month, 'loan_created',
        `Préstamo a ${borrowerName}: $${Number(amount).toFixed(2)}`, amount)

    const stmtMap = new Map([[String(statementId), { year: stmt.year, month: stmt.month }]])
    return enrichLoan(loan, stmtMap)
}

async function pay(userId, loanId, { amount } = {}) {
    const loan = await Loan.findOne({ _id: loanId, userId })
    if (!loan) throw myError('Préstamo no encontrado', 404)
    if (loan.status !== 'pending') throw myError('Solo se puede cobrar un préstamo pendiente', 400)

    const remaining = loan.amount - (loan.paidAmount || 0)
    const payAmt = amount !== undefined ? Number(amount) : remaining
    if (payAmt <= 0) throw myError('Monto inválido', 400)
    if (payAmt > remaining) throw myError(`No puedes cobrar más de lo pendiente ($${remaining.toFixed(2)})`, 400)

    loan.paidAmount = (loan.paidAmount || 0) + payAmt

    if (loan.paidAmount >= loan.amount) {
        loan.status = 'paid'
        loan.paidAt = new Date()
        loan.history.push({ type: 'paid', date: new Date(), amount: payAmt })
    } else {
        loan.history.push({ type: 'partial_payment', date: new Date(), amount: payAmt })
    }
    await loan.save()

    const stmtMap = await buildStmtMap([loan])
    const stmtRef = stmtMap.get(String(loan.currentStatementId))
    if (stmtRef) {
        if (loan.status === 'paid') {
            await log(userId, stmtRef.year, stmtRef.month, 'loan_paid',
                `Préstamo cobrado: ${loan.borrowerName} $${loan.amount.toFixed(2)}`, loan.amount)
        } else {
            await log(userId, stmtRef.year, stmtRef.month, 'loan_partial',
                `Cobro parcial: ${loan.borrowerName} $${payAmt.toFixed(2)} de $${loan.amount.toFixed(2)}`, payAmt)
        }
    }

    return {
        loan: enrichLoan(loan, stmtMap),
        needsSavingsRepayment: loan.status === 'paid' && loan.fromSavings && !loan.paidBackToSavings
    }
}

async function transfer(userId, loanId, { toStatementId }) {
    const loan = await Loan.findOne({ _id: loanId, userId })
    if (!loan) throw myError('Préstamo no encontrado', 404)
    if (loan.status !== 'pending') throw myError('Solo se puede transferir un préstamo pendiente', 400)
    if (String(loan.currentStatementId) === String(toStatementId)) {
        throw myError('El mes destino debe ser diferente al actual', 400)
    }

    const targetStmt = await Statement.findOne({ _id: toStatementId, userId })
    if (!targetStmt) throw myError('Mes destino no encontrado', 404)

    const originStmt = await Statement.findOne({ _id: loan.currentStatementId, userId }, 'year month')
    if (originStmt) {
        const originKey = originStmt.year * 100 + originStmt.month
        const targetKey = targetStmt.year * 100 + targetStmt.month
        if (targetKey <= originKey) throw myError('Solo puedes transferir a un mes posterior', 400)
    }

    let withdrawal = null
    if (!loan.fromCard) {
        // fromCard loans are covered by card payment — no savings withdrawal needed
        const savingsAcc = await ensureSavingsAccount(userId)
        withdrawal = await SavingsMovement.create({
            userId,
            accountId: savingsAcc._id,
            type: 'withdrawal',
            amount: loan.amount,
            description: `Préstamo a ${loan.borrowerName} → transferido a ${targetStmt.year}/${String(targetStmt.month).padStart(2, '0')}`,
            monthlyStatementId: loan.currentStatementId,
            date: new Date()
        })
    }

    // Marcar original como transferido
    loan.status = 'transferred'
    loan.history.push({ type: 'transferred', date: new Date(), toStatementId, savingsMovementId: withdrawal ? withdrawal._id : null })
    await loan.save()

    // Nuevo préstamo en el mes destino
    const newLoan = await Loan.create({
        userId,
        borrowerName: loan.borrowerName,
        amount: loan.amount,
        lentDate: loan.lentDate,
        originStatementId: loan.originStatementId,
        currentStatementId: toStatementId,
        status: 'pending',
        fromSavings: !loan.fromCard && !!withdrawal,
        savingsWithdrawalId: withdrawal ? withdrawal._id : null,
        fromCard: loan.fromCard || false,
        cardPurchaseId: loan.cardPurchaseId || null,
        history: [{ type: 'transferred', date: new Date(), toStatementId }]
    })

    await log(userId, originStmt.year, originStmt.month, 'loan_transferred',
        `Préstamo transferido: ${loan.borrowerName} $${loan.amount.toFixed(2)} → ${targetStmt.year}/${String(targetStmt.month).padStart(2, '0')}`,
        loan.amount)

    const allLoans = [loan, newLoan]
    const stmtMap = await buildStmtMap(allLoans)
    return {
        originalLoan: enrichLoan(loan, stmtMap),
        newLoan: enrichLoan(newLoan, stmtMap),
        savingsMovementId: withdrawal ? withdrawal._id : null
    }
}

async function repaySavings(userId, loanId) {
    const loan = await Loan.findOne({ _id: loanId, userId })
    if (!loan) throw myError('Préstamo no encontrado', 404)
    if (loan.status !== 'paid') throw myError('Solo se puede devolver ahorros de un préstamo cobrado', 400)
    if (loan.fromCard) throw myError('Este préstamo es de tarjeta — no requiere devolver ahorros', 400)
    if (!loan.fromSavings) throw myError('Este préstamo no fue cubierto por ahorros', 400)
    if (loan.paidBackToSavings) throw myError('Ya se devolvió a ahorros', 400)

    const savingsAcc = await ensureSavingsAccount(userId)

    const deposit = await SavingsMovement.create({
        userId,
        accountId: savingsAcc._id,
        type: 'deposit',
        amount: loan.amount,
        description: `Devolución de préstamo a ahorros - ${loan.borrowerName}`,
        date: new Date()
    })

    loan.paidBackToSavings = true
    loan.savingsDepositId = deposit._id
    loan.history.push({ type: 'repaid_savings', date: new Date(), savingsMovementId: deposit._id })
    await loan.save()

    const stmtMap = await buildStmtMap([loan])
    const stmtRef = stmtMap.get(String(loan.currentStatementId))
    if (stmtRef) {
        await log(userId, stmtRef.year, stmtRef.month, 'loan_repaid_savings',
            `Ahorros devueltos por préstamo: ${loan.borrowerName} $${loan.amount.toFixed(2)}`, loan.amount)
    }

    return enrichLoan(loan, stmtMap)
}

async function remove(userId, loanId) {
    const loan = await Loan.findOne({ _id: loanId, userId })
    if (!loan) throw myError('Préstamo no encontrado', 404)
    if (loan.status !== 'pending') throw myError('Solo se puede eliminar un préstamo pendiente', 400)
    if (loan.fromSavings) throw myError('No se puede eliminar un préstamo cubierto por ahorros', 400)
    if (loan.fromCard) throw myError('No se puede eliminar un préstamo de tarjeta directamente', 400)

    const stmt = await Statement.findById(loan.currentStatementId, 'year month').lean()
    await loan.deleteOne()
    if (stmt) {
        await log(userId, stmt.year, stmt.month, 'loan_deleted',
            `Préstamo eliminado: ${loan.borrowerName} $${loan.amount.toFixed(2)}`, loan.amount)
    }
    return { _id: loanId }
}

module.exports = { list, listForStatement, getPendingTotal, create, pay, transfer, repaySavings, remove }
