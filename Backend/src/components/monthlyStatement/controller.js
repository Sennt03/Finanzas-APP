const Statement = require('./model')
const Template = require('../budgetTemplate/model')
const Account = require('../account/model')
const SavingsMovement = require('../savingsMovement/model')
const creditPurchaseController = require('../creditPurchase/controller')
const myError = require('../../libs/myError')

function totalBudgeted(categories) {
    return (categories || []).reduce((acc, cat) =>
        acc + (cat.items || []).reduce((a, it) => a + (it.budgetedAmount || 0), 0), 0)
}

function totalPaid(categories) {
    return (categories || []).reduce((acc, cat) =>
        acc + (cat.items || []).filter(i => i.isPaid || i.paidAmount > 0).reduce((a, it) => a + (it.paidAmount || 0), 0), 0)
}

function sumExtras(extras, type) {
    return (extras || [])
        .filter(e => (e.type || 'expense') === type)
        .reduce((a, e) => a + (e.amount || 0), 0)
}

function buildVirtualCategory(idTag, name, items, groupKey, creditState) {
    const isPaid = !!(creditState && creditState[groupKey + 'Paid'])
    const paidAt = creditState ? creditState[groupKey + 'PaidAt'] : null
    return {
        _id: idTag,
        name,
        kind: 'credit',
        items,
        isVirtual: true,
        groupKey,
        categoryPaid: isPaid,
        categoryPaidAt: paidAt
    }
}

async function buildEnrichedStatement(stmt, userId) {
    const obj = stmt.toObject ? stmt.toObject() : stmt
    const cs = obj.creditState || {}
    const { tdc, diferidos } = await creditPurchaseController.findCuotasForMonth(userId, obj.year, obj.month)

    // Una sola categoría virtual con TDC + Diferidos combinados
    const allCreditItems = [
        ...tdc.map(i => ({ ...i, subType: 'tdc' })),
        ...diferidos.map(i => ({ ...i, subType: 'diferido' }))
    ]
    const virtualCats = []
    if (allCreditItems.length > 0) {
        virtualCats.push(buildVirtualCategory('__credit__', 'Tarjeta de crédito', allCreditItems, 'tdc', cs))
    }
    obj.categories = [...(obj.categories || []), ...virtualCats]

    const start = new Date(obj.year, obj.month - 1, 1)
    const end = new Date(obj.year, obj.month, 1)
    const movs = await SavingsMovement.find({ userId, date: { $gte: start, $lt: end } })
    const monthDeposits = movs.filter(m => m.type === 'deposit').reduce((s, m) => s + m.amount, 0)
    const monthWithdrawals = movs.filter(m => m.type === 'withdrawal').reduce((s, m) => s + m.amount, 0)

    const budgeted = totalBudgeted((obj.categories || []).filter(c => !c.isVirtual))
    const paid = totalPaid((obj.categories || []).filter(c => !c.isVirtual))
    const extrasExpense = sumExtras(obj.extras, 'expense')
    const extrasIncome = sumExtras(obj.extras, 'income')

    const tdcShare = tdc.reduce((s, i) => s + i.budgetedAmount, 0)
    const difShare = diferidos.reduce((s, i) => s + i.budgetedAmount, 0)
    const creditTotal = tdcShare + difShare
    const groupPaid = !!cs.tdcPaid
    const creditPaidAmt = groupPaid ? creditTotal : 0
    const creditPending = creditTotal - creditPaidAmt

    const realBalance = obj.salary - paid - extrasExpense + extrasIncome + monthWithdrawals - creditPaidAmt
    const availableBalance = obj.salary - paid - extrasExpense + extrasIncome + monthWithdrawals - creditTotal

    obj.summary = {
        totalBudgeted: budgeted,
        totalPaid: paid,
        totalExtras: extrasExpense,
        totalExtrasIncome: extrasIncome,
        remainingSalary: realBalance,
        availableBalance: availableBalance,
        availableToBudget: obj.salary - budgeted,
        savings: { monthDeposits, monthWithdrawals },
        creditCard: {
            total: creditTotal,
            paid: creditPaidAmt,
            pending: creditPending,
            groupPaid,
            tdcShare,
            diferidosShare: difShare
        }
    }

    return obj
}

async function toggleCreditGroup(userId, statementId, { paid }) {
    const stmt = await Statement.findOne({ _id: statementId, userId })
    if (!stmt) throw myError('Statement not found', 404)

    if (!stmt.creditState) stmt.creditState = {}
    stmt.creditState.tdcPaid = !!paid
    stmt.creditState.diferidosPaid = !!paid
    stmt.creditState.tdcPaidAt = paid ? new Date() : null
    stmt.creditState.diferidosPaidAt = paid ? new Date() : null

    const CreditPurchase = require('../creditPurchase/model')
    const purchases = await CreditPurchase.find({ userId })
    for (const p of purchases) {
        let dirty = false
        for (const c of p.cuotas) {
            if (c.year === stmt.year && c.month === stmt.month) {
                c.isPaid = !!paid
                c.paidAmount = paid ? c.amount : 0
                c.paidAt = paid ? new Date() : null
                dirty = true
            }
        }
        if (dirty) await p.save()
    }

    await stmt.save()
    return buildEnrichedStatement(stmt, userId)
}

async function convertMovement(userId, statementId, { source, target }) {
    const stmt = await Statement.findOne({ _id: statementId, userId })
    if (!stmt) throw myError('Statement not found', 404)

    const CreditPurchase = require('../creditPurchase/model')

    // 1. Extraer datos de la fuente
    let name, amount, date
    if (source.kind === 'item') {
        const cat = stmt.categories.id(source.categoryId)
        if (!cat) throw myError('Categoría no encontrada', 404)
        const item = cat.items.id(source.itemId)
        if (!item) throw myError('Item no encontrado', 404)
        name = item.name
        amount = item.budgetedAmount
        date = new Date(stmt.year, stmt.month - 1, 1)
        item.deleteOne()
        await stmt.save()
    } else if (source.kind === 'extra') {
        const extra = stmt.extras.id(source.extraId)
        if (!extra) throw myError('Extra no encontrado', 404)
        name = extra.name
        amount = extra.amount
        date = extra.date
        extra.deleteOne()
        await stmt.save()
    } else if (source.kind === 'purchase') {
        const p = await CreditPurchase.findOne({ _id: source.purchaseId, userId })
        if (!p) throw myError('Compra no encontrada', 404)
        name = p.name
        amount = p.totalAmount
        date = p.purchaseDate
        await p.deleteOne()
    } else {
        throw myError('Origen inválido', 400)
    }

    // 2. Crear destino
    const tDate = target.date ? new Date(target.date) : (date || new Date())

    if (target.type === 'expense' || target.type === 'income') {
        stmt.extras.push({
            name,
            amount,
            type: target.type,
            categoryName: target.categoryName || '',
            date: tDate
        })
        await stmt.save()
    } else if (target.type === 'tdc' || target.type === 'diferido') {
        const installments = target.type === 'diferido' ? Math.max(2, target.installments || 2) : 1
        await creditPurchaseController.create(userId, {
            name,
            totalAmount: amount,
            purchaseDate: tDate,
            installments
        })
    } else {
        throw myError('Tipo destino inválido', 400)
    }

    const fresh = await Statement.findById(stmt._id)
    return buildEnrichedStatement(fresh, userId)
}

async function list(userId) {
    const stmts = await Statement.find({ userId }).sort({ year: -1, month: -1 })
    return Promise.all(stmts.map(s => buildEnrichedStatement(s, userId)))
}

async function getOne(userId, id) {
    const stmt = await Statement.findOne({ _id: id, userId })
    if (!stmt) throw myError('Statement not found', 404)
    return buildEnrichedStatement(stmt, userId)
}

async function create(userId, { year, month, salary }) {
    const exists = await Statement.findOne({ userId, year, month })
    if (exists) throw myError('Ya existe un estado de cuenta para ese mes', 400)

    const tpl = await Template.findOne({ userId })
    const finalSalary = salary !== undefined ? salary : (tpl?.defaultSalary || 0)

    const categories = (tpl?.categories || []).map(cat => ({
        name: cat.name,
        kind: cat.kind,
        items: (cat.items || []).map(it => ({
            name: it.name,
            budgetedAmount: it.amount || 0,
            isPaid: false,
            paidAmount: 0,
            paidAt: null
        }))
    }))

    const budgeted = totalBudgeted(categories)
    if (budgeted > finalSalary) {
        throw myError(`El total presupuestado del template (${budgeted}) excede el sueldo (${finalSalary}). Ajusta el sueldo o el template.`, 400)
    }

    const stmt = await Statement.create({
        userId, year, month, salary: finalSalary, categories, extras: []
    })
    return buildEnrichedStatement(stmt, userId)
}

async function updateMeta(userId, id, { salary, categories }) {
    const stmt = await Statement.findOne({ _id: id, userId })
    if (!stmt) throw myError('Statement not found', 404)

    if (salary !== undefined) stmt.salary = salary
    if (categories !== undefined) {
        // Preservar isPaid/paidAmount/paidAt cuando coincide _id
        const oldMap = new Map()
        for (const cat of stmt.categories) {
            for (const it of cat.items) {
                oldMap.set(String(it._id), it)
            }
        }
        stmt.categories = categories.map(cat => ({
            _id: cat._id,
            name: cat.name,
            kind: cat.kind || 'expense',
            items: (cat.items || []).map(it => {
                const prev = it._id ? oldMap.get(String(it._id)) : null
                return {
                    _id: it._id,
                    name: it.name,
                    budgetedAmount: it.budgetedAmount || 0,
                    isPaid: prev?.isPaid || false,
                    paidAmount: prev?.paidAmount || 0,
                    paidAt: prev?.paidAt || null
                }
            })
        }))
    }

    const budgeted = totalBudgeted(stmt.categories)
    if (budgeted > stmt.salary) {
        throw myError(`El total presupuestado (${budgeted}) excede el sueldo (${stmt.salary})`, 400)
    }

    await stmt.save()
    return buildEnrichedStatement(stmt, userId)
}

async function setItemAmount(userId, id, { categoryId, itemId, amount, purchaseId }) {
    const stmt = await Statement.findOne({ _id: id, userId })
    if (!stmt) throw myError('Statement not found', 404)

    if (purchaseId) {
        await creditPurchaseController.setCuotaAmount(userId, purchaseId, itemId, amount)
        return buildEnrichedStatement(stmt, userId)
    }

    const cat = stmt.categories.id(categoryId)
    if (!cat) throw myError('Categoría no encontrada', 404)
    const item = cat.items.id(itemId)
    if (!item) throw myError('Item no encontrado', 404)

    const amt = Number(amount) || 0
    if (amt < 0) throw myError('Monto inválido', 400)
    if (amt > item.budgetedAmount) {
        throw myError(`No puedes registrar más de ${item.budgetedAmount} en este item`, 400)
    }

    item.paidAmount = amt
    if (item.budgetedAmount > 0 && amt >= item.budgetedAmount) {
        item.isPaid = true
        item.paidAt = item.paidAt || new Date()
    } else {
        item.isPaid = false
        item.paidAt = null
    }

    if (cat.kind === 'savings') {
        let savingsAcc = await Account.findOne({ userId, type: 'savings' })
        if (!savingsAcc) {
            const accountController = require('../account/controller')
            await accountController.bootstrap(userId)
            savingsAcc = await Account.findOne({ userId, type: 'savings' })
        }

        const existing = await SavingsMovement.findOne({
            userId,
            monthlyStatementId: stmt._id,
            'itemRef.itemId': item._id
        })

        if (amt === 0) {
            if (existing) await existing.deleteOne()
        } else if (existing) {
            existing.amount = amt
            existing.description = `${cat.name} / ${item.name}`
            await existing.save()
        } else if (savingsAcc) {
            await SavingsMovement.create({
                userId,
                accountId: savingsAcc._id,
                type: 'deposit',
                amount: amt,
                description: `${cat.name} / ${item.name}`,
                monthlyStatementId: stmt._id,
                itemRef: { categoryId: cat._id, itemId: item._id },
                date: new Date(stmt.year, stmt.month - 1, new Date().getDate())
            })
        }
    }

    await stmt.save()
    return buildEnrichedStatement(stmt, userId)
}

async function addExtra(userId, id, data) {
    const stmt = await Statement.findOne({ _id: id, userId })
    if (!stmt) throw myError('Statement not found', 404)
    stmt.extras.push(data)
    await stmt.save()
    return buildEnrichedStatement(stmt, userId)
}

async function removeExtra(userId, id, extraId) {
    const stmt = await Statement.findOne({ _id: id, userId })
    if (!stmt) throw myError('Statement not found', 404)
    const extra = stmt.extras.id(extraId)
    if (!extra) throw myError('Extra no encontrado', 404)
    extra.deleteOne()
    await stmt.save()
    return buildEnrichedStatement(stmt, userId)
}

async function remove(userId, id) {
    const stmt = await Statement.findOne({ _id: id, userId })
    if (!stmt) throw myError('Statement not found', 404)
    await SavingsMovement.deleteMany({ userId, monthlyStatementId: stmt._id })
    await stmt.deleteOne()
    return { _id: id }
}

module.exports = {
    list, getOne, create, updateMeta,
    setItemAmount,
    addExtra, removeExtra,
    toggleCreditGroup,
    convertMovement,
    remove
}
