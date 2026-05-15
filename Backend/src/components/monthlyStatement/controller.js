const Statement = require('./model')
const Template = require('../budgetTemplate/model')
const Account = require('../account/model')
const SavingsMovement = require('../savingsMovement/model')
const creditPurchaseController = require('../creditPurchase/controller')
const myError = require('../../libs/myError')
const log = require('../../libs/activityLog')

function isCreditItem(it) {
    return it && it.paymentMethod === 'credit'
}

function sumItems(cat) {
    return (cat.items || []).reduce((a, it) => a + (it.budgetedAmount || 0), 0)
}

function sumCreditItems(categories) {
    return (categories || [])
        .filter(c => !c.isVirtual)
        .reduce((acc, cat) =>
            acc + (cat.items || [])
                .filter(isCreditItem)
                .reduce((a, it) => a + (it.budgetedAmount || 0), 0)
        , 0)
}

function categoryBudget(cat) {
    return (cat.totalAmount && cat.totalAmount > 0) ? cat.totalAmount : sumItems(cat)
}

function totalBudgeted(categories) {
    return (categories || []).reduce((acc, cat) => acc + categoryBudget(cat), 0)
}

// Suma de pagos de items pagados en efectivo (los credit cuentan vía creditCard.paid)
function totalPaidCash(categories) {
    return (categories || []).reduce((acc, cat) =>
        acc + (cat.items || [])
            .filter(i => !isCreditItem(i) && (i.isPaid || i.paidAmount > 0))
            .reduce((a, it) => a + (it.paidAmount || 0), 0)
    , 0)
}

function sumExtras(extras, type) {
    return (extras || [])
        .filter(e => (e.type || 'expense') === type)
        .reduce((a, e) => a + (e.amount || 0), 0)
}

function buildVirtualCategory(idTag, name, items, groupKey, creditState, extras = {}) {
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
        categoryPaidAt: paidAt,
        externalCreditItems: extras.externalCreditItems || [],
        totalAll: extras.totalAll || 0
    }
}

function collectExternalCreditItems(categories) {
    const out = []
    for (const cat of categories || []) {
        if (cat.isVirtual) continue
        for (const it of cat.items || []) {
            if (it && it.paymentMethod === 'credit') {
                out.push({
                    itemId: String(it._id),
                    categoryId: String(cat._id),
                    name: it.name,
                    amount: it.budgetedAmount || 0,
                    categoryName: cat.name,
                    isPaid: !!it.isPaid
                })
            }
        }
    }
    return out
}

async function buildEnrichedStatement(stmt, userId) {
    const obj = stmt.toObject ? stmt.toObject() : stmt
    const cs = obj.creditState || {}
    const { tdc, diferidos } = await creditPurchaseController.findCuotasForMonth(userId, obj.year, obj.month)

    // Items credit "dispersos" en otras categorías del statement
    const externalCreditItems = collectExternalCreditItems(obj.categories || [])

    // Una sola categoría virtual con TDC + Diferidos combinados
    const allCreditItems = [
        ...tdc.map(i => ({ ...i, subType: 'tdc' })),
        ...diferidos.map(i => ({ ...i, subType: 'diferido' }))
    ]
    const virtualCats = []
    if (allCreditItems.length > 0 || externalCreditItems.length > 0) {
        const cuotasTotal = allCreditItems.reduce((s, i) => s + (i.budgetedAmount || 0), 0)
        const extTotal = externalCreditItems.reduce((s, i) => s + (i.amount || 0), 0)
        virtualCats.push(buildVirtualCategory('__credit__', 'Tarjeta de crédito', allCreditItems, 'tdc', cs, {
            externalCreditItems,
            totalAll: cuotasTotal + extTotal
        }))
    }
    obj.categories = [...(obj.categories || []), ...virtualCats]

    const start = new Date(obj.year, obj.month - 1, 1)
    const end = new Date(obj.year, obj.month, 1)
    const movs = await SavingsMovement.find({ userId, date: { $gte: start, $lt: end } })
    const monthDeposits = movs.filter(m => m.type === 'deposit').reduce((s, m) => s + m.amount, 0)
    const monthWithdrawals = movs.filter(m => m.type === 'withdrawal').reduce((s, m) => s + m.amount, 0)

    const Loan = require('../loan/model')
    const allCurrentLoans = await Loan.find({ userId, currentStatementId: obj._id })

    // Only non-fromSavings, non-fromCard pending/transferred loans deduct from balance.
    const balancePendingTotal = allCurrentLoans
        .filter(l => ['pending', 'transferred'].includes(l.status) && !l.fromSavings && !l.fromCard)
        .reduce((s, l) => s + (l.amount - (l.paidAmount || 0)), 0)

    // For the display hint: only genuine pending (not transferred, not fromSavings, not fromCard).
    const pendingLoansTotal = allCurrentLoans
        .filter(l => l.status === 'pending' && !l.fromSavings && !l.fromCard)
        .reduce((s, l) => s + (l.amount - (l.paidAmount || 0)), 0)

    // fromSavings loans collected: add to balance. When repaid to savings: net = 0.
    const paidFromSavingsNet = allCurrentLoans
        .filter(l => l.fromSavings)
        .reduce((s, l) => {
            const collected = l.paidAmount || 0
            const repaid = l.paidBackToSavings ? (l.amount || 0) : 0
            return s + collected - repaid
        }, 0)

    // fromCard loans collected: add to balance (card already covered the deduction).
    const paidFromCardNet = allCurrentLoans
        .filter(l => l.fromCard)
        .reduce((s, l) => s + (l.paidAmount || 0), 0)

    const nonVirtual = (obj.categories || []).filter(c => !c.isVirtual)
    const budgeted = totalBudgeted(nonVirtual)
    const paid = totalPaidCash(nonVirtual)
    const extrasExpense = sumExtras(obj.extras, 'expense')
    const extrasIncome = sumExtras(obj.extras, 'income')

    const tdcShare = tdc.reduce((s, i) => s + i.budgetedAmount, 0)
    const difShare = diferidos.reduce((s, i) => s + i.budgetedAmount, 0)
    const itemsShare = sumCreditItems(nonVirtual)
    const creditTotal = tdcShare + difShare + itemsShare
    const groupPaid = !!cs.tdcPaid
    const creditPaidAmt = groupPaid ? creditTotal : 0
    const creditPending = creditTotal - creditPaidAmt

    // Shared card cuotas: amount paid back by borrowers adds to balance.
    const allCuotas = [...tdc, ...diferidos]
    const paidByBorrowerNet = allCuotas
        .filter(i => i.isShared)
        .reduce((s, i) => s + (i.paidByBorrower || 0), 0)
    const sharedShare = allCuotas
        .filter(i => i.isShared)
        .reduce((s, i) => s + i.budgetedAmount, 0)

    const base = obj.salary - paid - extrasExpense + extrasIncome + monthWithdrawals + paidFromSavingsNet + paidByBorrowerNet + paidFromCardNet
    const realBalance = base - creditPaidAmt - balancePendingTotal
    const availableBalance = base - creditTotal - balancePendingTotal

    obj.summary = {
        totalBudgeted: budgeted,
        totalPaid: paid,
        totalExtras: extrasExpense,
        totalExtrasIncome: extrasIncome,
        remainingSalary: realBalance,
        availableBalance: availableBalance,
        availableToBudget: obj.salary - budgeted,
        pendingLoansTotal,
        savings: { monthDeposits, monthWithdrawals },
        creditCard: {
            total: creditTotal,
            paid: creditPaidAmt,
            pending: creditPending,
            groupPaid,
            tdcShare,
            diferidosShare: difShare,
            itemsShare,
            sharedShare,
            ownShare: creditTotal - sharedShare
        }
    }

    return obj
}

async function toggleCreditGroup(userId, statementId, { paid }) {
    const stmt = await Statement.findOne({ _id: statementId, userId })
    if (!stmt) throw myError('Statement not found', 404)

    if (!stmt.creditState) stmt.creditState = {}
    const now = new Date()
    stmt.creditState.tdcPaid = !!paid
    stmt.creditState.diferidosPaid = !!paid
    stmt.creditState.tdcPaidAt = paid ? now : null
    stmt.creditState.diferidosPaidAt = paid ? now : null

    // Propagar pago a items con paymentMethod='credit' dentro de las categorías del mes
    for (const cat of stmt.categories || []) {
        for (const it of cat.items || []) {
            if (isCreditItem(it)) {
                it.isPaid = !!paid
                it.paidAmount = paid ? (it.budgetedAmount || 0) : 0
                it.paidAt = paid ? now : null
            }
        }
    }

    const CreditPurchase = require('../creditPurchase/model')
    const purchases = await CreditPurchase.find({ userId })
    for (const p of purchases) {
        let dirty = false
        for (const c of p.cuotas) {
            if (c.year === stmt.year && c.month === stmt.month) {
                c.isPaid = !!paid
                c.paidAmount = paid ? c.amount : 0
                c.paidAt = paid ? now : null
                dirty = true
            }
        }
        if (dirty) await p.save()
    }

    await stmt.save()
    const action = paid ? 'credit_group_paid' : 'credit_group_unpaid'
    const desc = paid ? 'Tarjeta de crédito marcada como pagada' : 'Tarjeta de crédito desmarcada'
    await log(userId, stmt.year, stmt.month, action, desc)
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

    const typeLabels = { expense: 'Gasto cash', income: 'Ingreso', tdc: 'TDC', diferido: 'Diferido' }
    const targetLabel = typeLabels[target.type] || target.type
    await log(userId, stmt.year, stmt.month, 'item_converted',
        `Convertido a ${targetLabel}: ${name} $${Number(amount).toFixed(2)}`, amount)

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
        totalAmount: cat.totalAmount || 0,
        items: (cat.items || []).map(it => ({
            name: it.name,
            budgetedAmount: it.amount || 0,
            isPaid: false,
            paidAmount: 0,
            paidAt: null,
            paymentMethod: it.paymentMethod === 'credit' ? 'credit' : 'cash'
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
        const groupPaid = !!(stmt.creditState && stmt.creditState.tdcPaid)
        stmt.categories = categories.map(cat => ({
            _id: cat._id,
            name: cat.name,
            kind: cat.kind || 'expense',
            totalAmount: cat.totalAmount || 0,
            items: (cat.items || []).map(it => {
                const prev = it._id ? oldMap.get(String(it._id)) : null
                const pm = it.paymentMethod === 'credit' ? 'credit' : 'cash'
                const prevPm = prev?.paymentMethod === 'credit' ? 'credit' : 'cash'
                const changedMethod = prev && prevPm !== pm

                if (pm === 'credit') {
                    // En credit el pago lo gobierna el toggle grupal
                    return {
                        _id: it._id,
                        name: it.name,
                        budgetedAmount: it.budgetedAmount || 0,
                        isPaid: groupPaid,
                        paidAmount: groupPaid ? (it.budgetedAmount || 0) : 0,
                        paidAt: groupPaid ? (prev?.paidAt || new Date()) : null,
                        paymentMethod: 'credit'
                    }
                }
                // cash: si venía de credit, reseteamos el pago (lo de "pagado" venía del toggle grupal)
                if (changedMethod) {
                    return {
                        _id: it._id,
                        name: it.name,
                        budgetedAmount: it.budgetedAmount || 0,
                        isPaid: false,
                        paidAmount: 0,
                        paidAt: null,
                        paymentMethod: 'cash'
                    }
                }
                return {
                    _id: it._id,
                    name: it.name,
                    budgetedAmount: it.budgetedAmount || 0,
                    isPaid: prev?.isPaid || false,
                    paidAmount: prev?.paidAmount || 0,
                    paidAt: prev?.paidAt || null,
                    paymentMethod: 'cash'
                }
            })
        }))
    }

    // Validar items vs total por categoría
    for (const cat of stmt.categories) {
        if (cat.totalAmount && cat.totalAmount > 0) {
            const used = sumItems(cat)
            if (used > cat.totalAmount) {
                throw myError(`Los items de "${cat.name}" exceden el total de la categoría (${used} > ${cat.totalAmount})`, 400)
            }
        }
    }

    const budgeted = totalBudgeted(stmt.categories)
    if (budgeted > stmt.salary) {
        throw myError(`El total presupuestado (${budgeted}) excede el sueldo (${stmt.salary})`, 400)
    }

    await stmt.save()
    await log(userId, stmt.year, stmt.month, 'budget_updated',
        `Presupuesto actualizado: sueldo $${stmt.salary.toFixed(2)}`, stmt.salary)
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

    if (isCreditItem(item)) {
        throw myError('Este item se paga con tarjeta. Usa el toggle grupal de Tarjeta de crédito.', 400)
    }

    const amt = Number(amount) || 0
    if (amt < 0) throw myError('Monto inválido', 400)
    if (amt > item.budgetedAmount) {
        throw myError(`No puedes registrar más de ${item.budgetedAmount} en este item`, 400)
    }

    const prevPaid = item.isPaid
    const prevAmount = item.paidAmount

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

    let logAction, logDesc
    if (amt === 0 && (prevAmount > 0 || prevPaid)) {
        logAction = 'item_unpaid'
        logDesc = `Desmarcado: ${item.name} (${cat.name})`
    } else if (item.isPaid && !prevPaid) {
        logAction = 'item_paid'
        logDesc = `Pagado: ${item.name} (${cat.name}) $${amt.toFixed(2)}`
    } else if (amt > 0 && amt !== prevAmount) {
        logAction = 'item_partial'
        logDesc = `Pago parcial: ${item.name} (${cat.name}) $${amt.toFixed(2)} de $${item.budgetedAmount.toFixed(2)}`
    }
    if (logAction) await log(userId, stmt.year, stmt.month, logAction, logDesc, amt || null)

    return buildEnrichedStatement(stmt, userId)
}

async function addExtra(userId, id, data) {
    const stmt = await Statement.findOne({ _id: id, userId })
    if (!stmt) throw myError('Statement not found', 404)
    stmt.extras.push(data)
    await stmt.save()
    const typeLabel = data.type === 'income' ? 'Ingreso extra' : 'Gasto extra'
    await log(userId, stmt.year, stmt.month, 'extra_added',
        `${typeLabel}: ${data.name} $${Number(data.amount).toFixed(2)}`, data.amount)
    return buildEnrichedStatement(stmt, userId)
}

async function removeExtra(userId, id, extraId) {
    const stmt = await Statement.findOne({ _id: id, userId })
    if (!stmt) throw myError('Statement not found', 404)
    const extra = stmt.extras.id(extraId)
    if (!extra) throw myError('Extra no encontrado', 404)
    const extraName = extra.name
    const extraAmount = extra.amount
    extra.deleteOne()
    await stmt.save()
    await log(userId, stmt.year, stmt.month, 'extra_deleted',
        `Eliminado: ${extraName} $${Number(extraAmount).toFixed(2)}`, extraAmount)
    return buildEnrichedStatement(stmt, userId)
}

async function addItemToCategory(userId, id, categoryId, { name, budgetedAmount, paymentMethod }) {
    const stmt = await Statement.findOne({ _id: id, userId })
    if (!stmt) throw myError('Statement not found', 404)

    const cat = stmt.categories.id(categoryId)
    if (!cat) throw myError('Categoría no encontrada', 404)

    const amount = Number(budgetedAmount) || 0
    if (amount < 0) throw myError('Monto inválido', 400)

    if (cat.totalAmount && cat.totalAmount > 0) {
        const used = sumItems(cat)
        if (used + amount > cat.totalAmount) {
            throw myError(`El item excede el presupuesto de la categoría (libre: ${(cat.totalAmount - used).toFixed(2)})`, 400)
        }
    } else {
        const newTotalBudgeted = totalBudgeted(stmt.categories) + amount
        if (newTotalBudgeted > stmt.salary) {
            throw myError(`El item excede el sueldo (libre: ${(stmt.salary - totalBudgeted(stmt.categories)).toFixed(2)})`, 400)
        }
    }

    const pm = paymentMethod === 'credit' ? 'credit' : 'cash'
    const groupPaid = !!(stmt.creditState && stmt.creditState.tdcPaid)
    const startsPaid = pm === 'credit' && groupPaid
    cat.items.push({
        name,
        budgetedAmount: amount,
        isPaid: startsPaid,
        paidAmount: startsPaid ? amount : 0,
        paidAt: startsPaid ? new Date() : null,
        paymentMethod: pm
    })
    await stmt.save()
    const pmLabel = pm === 'credit' ? ' (tarjeta)' : ''
    await log(userId, stmt.year, stmt.month, 'item_added',
        `Item añadido: ${name} (${cat.name})${pmLabel} $${amount.toFixed(2)}`, amount)
    return buildEnrichedStatement(stmt, userId)
}

async function removeItemFromCategory(userId, id, categoryId, itemId) {
    const stmt = await Statement.findOne({ _id: id, userId })
    if (!stmt) throw myError('Statement not found', 404)

    const cat = stmt.categories.id(categoryId)
    if (!cat) throw myError('Categoría no encontrada', 404)
    const item = cat.items.id(itemId)
    if (!item) throw myError('Item no encontrado', 404)

    const itemName = item.name
    const itemAmount = item.budgetedAmount
    const catName = cat.name
    item.deleteOne()
    await stmt.save()
    await log(userId, stmt.year, stmt.month, 'item_deleted',
        `Eliminado: ${itemName} (${catName}) $${Number(itemAmount).toFixed(2)}`, itemAmount)
    return buildEnrichedStatement(stmt, userId)
}

async function updateCategoryMeta(userId, id, categoryId, data) {
    const stmt = await Statement.findOne({ _id: id, userId })
    if (!stmt) throw myError('Statement not found', 404)

    const cat = stmt.categories.id(categoryId)
    if (!cat) throw myError('Categoría no encontrada', 404)

    if (data.name !== undefined) cat.name = data.name
    if (data.kind !== undefined) cat.kind = data.kind
    if (data.totalAmount !== undefined) {
        const newTotal = Number(data.totalAmount) || 0
        if (newTotal > 0) {
            const used = sumItems(cat)
            if (newTotal < used) {
                throw myError(`El total no puede ser menor a los items ya creados (${used.toFixed(2)})`, 400)
            }
        }
        cat.totalAmount = newTotal
    }

    const otherBudget = stmt.categories
        .filter(c => String(c._id) !== String(cat._id))
        .reduce((acc, c) => acc + categoryBudget(c), 0)
    const thisBudget = categoryBudget(cat)
    if (otherBudget + thisBudget > stmt.salary) {
        throw myError(`Excede el sueldo (libre: ${(stmt.salary - otherBudget).toFixed(2)})`, 400)
    }

    await stmt.save()
    return buildEnrichedStatement(stmt, userId)
}

async function remove(userId, id) {
    const stmt = await Statement.findOne({ _id: id, userId })
    if (!stmt) throw myError('Statement not found', 404)
    await SavingsMovement.deleteMany({ userId, monthlyStatementId: stmt._id })
    const Loan = require('../loan/model')
    await Loan.deleteMany({
        userId,
        $or: [{ currentStatementId: stmt._id }, { originStatementId: stmt._id }]
    })
    const ActivityLog = require('../activityLog/model')
    await ActivityLog.deleteMany({ userId, year: stmt.year, month: stmt.month })
    await stmt.deleteOne()
    return { _id: id }
}

module.exports = {
    list, getOne, create, updateMeta,
    setItemAmount,
    addExtra, removeExtra,
    addItemToCategory, removeItemFromCategory, updateCategoryMeta,
    toggleCreditGroup,
    convertMovement,
    remove
}
