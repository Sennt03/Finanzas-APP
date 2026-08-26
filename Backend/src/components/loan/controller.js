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
    // Descuentan del mes: pending/transferred que NO son fromSavings/fromCard/transferDeferred.
    // (El 'transferred' de origen sigue restando aquí; en savings el retiro lo compensa.
    //  Los recibidos por transferencia de deuda ya se descontaron en su mes origen.)
    const loans = await Loan.find({ userId, currentStatementId: statementId, status: { $in: ['pending', 'transferred'] }, fromSavings: { $ne: true }, fromCard: { $ne: true }, transferDeferred: { $ne: true } })
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
        `Préstamo a ${borrowerName}: $${Number(amount).toFixed(2)}`, amount,
        { loanId: String(loan._id) })

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

// Deshacer el cobro de un préstamo: vuelve a 'pendiente' con paidAmount 0.
async function revertPayment(userId, loanId) {
    const loan = await Loan.findOne({ _id: loanId, userId })
    if (!loan) throw myError('Préstamo no encontrado', 404)
    if ((loan.paidAmount || 0) <= 0 && loan.status !== 'paid') {
        throw myError('Este préstamo no tiene cobros que revertir', 400)
    }
    if (loan.paidBackToSavings) {
        throw myError('Ya devolviste esta plata a ahorros. Deshaz eso primero.', 400)
    }
    if (loan.status === 'transferred') {
        throw myError('Este préstamo fue transferido; revierte la transferencia primero', 400)
    }
    loan.paidAmount = 0
    loan.status = 'pending'
    loan.paidAt = null
    loan.history.push({ type: 'payment_reverted', date: new Date() })
    await loan.save()

    const stmtMap = await buildStmtMap([loan])
    const stmtRef = stmtMap.get(String(loan.currentStatementId))
    if (stmtRef) {
        await log(userId, stmtRef.year, stmtRef.month, 'loan_payment_reverted',
            `Cobro revertido: ${loan.borrowerName} $${loan.amount.toFixed(2)} vuelve a pendiente`, loan.amount)
    }
    return enrichLoan(loan, stmtMap)
}

async function transfer(userId, loanId, { toStatementId, mode }) {
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

    // fromCard loans are always covered by the card payment — never touch savings ni cuentan en balance.
    // Para el resto el usuario elige:
    //   'savings' → retirar de ahorros para cubrir el mes actual (el nuevo préstamo queda fromSavings).
    //   'debt'    → solo mover el saldo pendiente al siguiente mes (el nuevo es un préstamo normal).
    const transferType = loan.fromCard ? null : mode
    const useSavings = transferType === 'savings'

    // Solo se transfiere el saldo pendiente, no el total original
    const remaining = loan.amount - (loan.paidAmount || 0)
    const targetLabel = `${targetStmt.year}/${String(targetStmt.month).padStart(2, '0')}`
    const originLabel = originStmt ? `${originStmt.year}/${String(originStmt.month).padStart(2, '0')}` : '—'

    let withdrawal = null
    if (useSavings && !loan.fromCard) {
        const savingsAcc = await ensureSavingsAccount(userId)
        // El retiro debe pesar en el MES DE ORIGEN del préstamo (no en el mes calendario de hoy),
        // porque buildEnrichedStatement suma los retiros por rango de fechas del mes. Así la
        // compensación (+remaining) cae en el mismo mes que el descuento del préstamo → neto 0
        // en el origen, y el mes destino nunca recibe nada. (Corrige el descuadre A2.)
        const withdrawalDate = originStmt
            ? new Date(originStmt.year, originStmt.month - 1, 15, 12, 0, 0)
            : new Date()
        withdrawal = await SavingsMovement.create({
            userId,
            accountId: savingsAcc._id,
            type: 'withdrawal',
            amount: remaining,
            description: `Préstamo a ${loan.borrowerName} → transferido a ${targetLabel}`,
            monthlyStatementId: loan.currentStatementId,
            date: withdrawalDate
        })
    }

    // Nuevo préstamo en el mes destino por el monto restante
    const newLoan = await Loan.create({
        userId,
        borrowerName: loan.borrowerName,
        amount: remaining,
        lentDate: loan.lentDate,
        originStatementId: loan.originStatementId,
        currentStatementId: toStatementId,
        status: 'pending',
        fromSavings: useSavings && !loan.fromCard && !!withdrawal,
        savingsWithdrawalId: withdrawal ? withdrawal._id : null,
        fromCard: loan.fromCard || false,
        cardPurchaseId: loan.cardPurchaseId || null,
        transferType,
        // Deuda: el principal ya se descontó en el mes origen (el original transferido lo sigue
        // restando), así que el nuevo NO descuenta del destino; solo suma al cobrarse.
        transferDeferred: transferType === 'debt',
        transferredFromLoanId: loan._id,
        history: [{ type: 'transferred', date: new Date(), fromStatementId: loan.currentStatementId, transferType }]
    })

    // Marcar original como transferido y enlazarlo al nuevo (para poder revertir)
    loan.status = 'transferred'
    loan.transferType = transferType
    loan.transferredToLoanId = newLoan._id
    loan.history.push({ type: 'transferred', date: new Date(), toStatementId, transferType, savingsMovementId: withdrawal ? withdrawal._id : null })
    await loan.save()

    const modeLabel = loan.fromCard ? 'tarjeta' : (useSavings ? 'cubierto con ahorros' : 'deuda al siguiente mes')
    if (originStmt) {
        await log(userId, originStmt.year, originStmt.month, 'loan_transferred',
            `Préstamo transferido: ${loan.borrowerName} $${remaining.toFixed(2)} → ${targetLabel} (${modeLabel})`,
            remaining, { loanId: String(newLoan._id), transferType })
    }
    await log(userId, targetStmt.year, targetStmt.month, 'loan_transferred',
        `Préstamo entrante: ${loan.borrowerName} $${remaining.toFixed(2)} desde ${originLabel} (${modeLabel})`,
        remaining, { loanId: String(newLoan._id), transferType })

    const allLoans = [loan, newLoan]
    const stmtMap = await buildStmtMap(allLoans)
    return {
        originalLoan: enrichLoan(loan, stmtMap),
        newLoan: enrichLoan(newLoan, stmtMap),
        savingsMovementId: withdrawal ? withdrawal._id : null
    }
}

async function revertTransfer(userId, loanId) {
    // Acepta el id del original transferido o el del préstamo nuevo: resolvemos el par.
    let original = await Loan.findOne({ _id: loanId, userId })
    if (!original) throw myError('Préstamo no encontrado', 404)

    if (original.status === 'pending' && original.transferredFromLoanId) {
        // Nos pasaron el préstamo nuevo → el original es su padre.
        const parent = await Loan.findOne({ _id: original.transferredFromLoanId, userId })
        if (!parent) throw myError('No se encontró el préstamo original de la transferencia', 404)
        original = parent
    }

    if (original.status !== 'transferred') throw myError('Solo se puede revertir un préstamo transferido', 400)
    if (!original.transferredToLoanId) throw myError('Esta transferencia es antigua y no se puede revertir automáticamente', 400)

    const newLoan = await Loan.findOne({ _id: original.transferredToLoanId, userId })
    if (!newLoan) throw myError('No se encontró el préstamo destino de la transferencia', 404)
    if (newLoan.status === 'transferred') throw myError('El préstamo ya fue transferido de nuevo — revierte esa transferencia primero', 400)
    if (newLoan.status === 'paid' || (newLoan.paidAmount || 0) > 0) {
        throw myError('No se puede revertir: el préstamo ya tiene cobros en el mes destino', 400)
    }

    const targetStmt = await Statement.findById(newLoan.currentStatementId, 'year month').lean()
    const originStmt = await Statement.findById(original.currentStatementId, 'year month').lean()

    // Deshacer el retiro de ahorros si la transferencia fue 'savings'.
    // El préstamo nuevo referencia su propio retiro; el historial es el respaldo.
    if (original.transferType === 'savings') {
        const fallback = [...original.history].reverse().find(h => h.type === 'transferred' && h.savingsMovementId)
        const withdrawalId = newLoan.savingsWithdrawalId || (fallback ? fallback.savingsMovementId : null)
        if (withdrawalId) await SavingsMovement.deleteOne({ _id: withdrawalId, userId })
    }

    // Borrar el préstamo nuevo y restaurar el original a pendiente
    await newLoan.deleteOne()

    original.status = 'pending'
    original.transferType = null
    original.transferredToLoanId = null
    original.history.push({ type: 'transfer_reverted', date: new Date() })
    await original.save()

    const remaining = newLoan.amount
    if (targetStmt) {
        await log(userId, targetStmt.year, targetStmt.month, 'loan_transfer_reverted',
            `Transferencia revertida: ${original.borrowerName} $${remaining.toFixed(2)} retirado de este mes`, remaining)
    }
    if (originStmt) {
        await log(userId, originStmt.year, originStmt.month, 'loan_transfer_reverted',
            `Transferencia revertida: ${original.borrowerName} $${remaining.toFixed(2)} regresó a este mes`, remaining)
    }

    const stmtMap = await buildStmtMap([original])
    return {
        loan: enrichLoan(original, stmtMap),
        removedLoanId: String(newLoan._id)
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

module.exports = { list, listForStatement, getPendingTotal, create, pay, revertPayment, transfer, revertTransfer, repaySavings, remove }
