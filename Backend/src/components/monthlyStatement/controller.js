const Statement = require('./model')
const Template = require('../budgetTemplate/model')
const Account = require('../account/model')
const SavingsMovement = require('../savingsMovement/model')
const creditPurchaseController = require('../creditPurchase/controller')
const cardController = require('../card/controller')
const myError = require('../../libs/myError')
const log = require('../../libs/activityLog')

function isCreditItem(it) {
    return it && it.paymentMethod === 'credit'
}

function sumItems(cat) {
    return (cat.items || []).reduce((a, it) => a + (it.budgetedAmount || 0), 0)
}

function r2(n) {
    return Math.round((Number(n) || 0) * 100) / 100
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
                    cardId: it.cardId ? String(it.cardId) : null,
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
    // Fase 2/3: consumo por categoría en el MES DE PRESUPUESTO + apartado del mes.
    const budgetData = await creditPurchaseController.findBudgetMonthData(userId, obj.year, obj.month)

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

    // Egresos de ahorros que ya están registrados como ingreso vinculado en este mes:
    // su aporte al saldo lo aporta el extra (extrasIncome), así que no se cuentan aquí
    // para evitar doble conteo. Se siguen mostrando en summary.savings.monthWithdrawals.
    const linkedSavingsIds = new Set(
        (obj.extras || []).filter(e => e.linkedSavingsId).map(e => String(e.linkedSavingsId))
    )
    const withdrawalsForBalance = movs
        .filter(m => m.type === 'withdrawal' && !linkedSavingsIds.has(String(m._id)))
        .reduce((s, m) => s + m.amount, 0)

    const Loan = require('../loan/model')
    const allCurrentLoans = await Loan.find({ userId, currentStatementId: obj._id })

    // Descuentan del disponible mientras viven en este mes: pending/transferred normales.
    // - 'pending' normal: el préstamo está vivo aquí.
    // - 'transferred' (origen de una transferencia): SIGUE descontando este mes porque el principal
    //   se prestó aquí (en savings el retiro de ahorros lo compensa; en debt queda restado).
    // Excluidos: fromSavings/fromCard y los RECIBIDOS por transferencia (transferDeferred):
    //   su principal ya se descontó en el mes origen → aquí solo se cobran (suman, ver abajo).
    const balancePendingTotal = allCurrentLoans
        .filter(l => {
            if (l.fromSavings || l.fromCard || l.transferDeferred) return false
            return l.status === 'pending' || l.status === 'transferred'
        })
        .reduce((s, l) => s + (l.amount - (l.paidAmount || 0)), 0)

    // For the display hint: only genuine pending (not transferred/savings/card/transferDeferred).
    const pendingLoansTotal = allCurrentLoans
        .filter(l => l.status === 'pending' && !l.fromSavings && !l.fromCard && !l.transferDeferred)
        .reduce((s, l) => s + (l.amount - (l.paidAmount || 0)), 0)

    // fromSavings loans collected: add to balance. When repaid to savings: net = 0.
    const paidFromSavingsNet = allCurrentLoans
        .filter(l => l.fromSavings)
        .reduce((s, l) => {
            const collected = l.paidAmount || 0
            const repaid = l.paidBackToSavings ? (l.amount || 0) : 0
            return s + collected - repaid
        }, 0)

    // Préstamos recibidos por transferencia de deuda: no descontaron aquí (ya lo hizo el mes origen),
    // pero al cobrarlos SUMAN al disponible de este mes ("cuando ya cobre sí me suma").
    const paidFromTransferNet = allCurrentLoans
        .filter(l => l.transferDeferred)
        .reduce((s, l) => s + (l.paidAmount || 0), 0)

    // fromCard loans collected: add to balance (card already covered the deduction).
    const paidFromCardNet = allCurrentLoans
        .filter(l => l.fromCard)
        .reduce((s, l) => s + (l.paidAmount || 0), 0)

    const nonVirtual = (obj.categories || []).filter(c => !c.isVirtual)
    const budgeted = totalBudgeted(nonVirtual)
    const paid = totalPaidCash(nonVirtual)
    const extrasExpense = sumExtras(obj.extras, 'expense')
    const extrasIncome = sumExtras(obj.extras, 'income')
    // Los movimientos "Ahorro" son gastos (salen de la transaccional) pero NO son consumo:
    // reducen el disponible y el origen igual que un gasto, pero no cuentan como "gastado".
    const savingsExtrasTotal = (obj.extras || [])
        .filter(e => e.savingsDepositId && (e.type || 'expense') === 'expense')
        .reduce((a, e) => a + (e.amount || 0), 0)

    // ----- Fase 2/3: envelope por categoría + PUEDO GASTAR -----
    // "spent" de una categoría = efectivo pagado + items a crédito (comprometidos)
    // + compras de tarjeta (propias) asignadas a la categoría en su mes de presupuesto.
    // "remaining" = presupuesto de la categoría − spent. PUEDO GASTAR = Σ remaining de
    // las categorías marcadas como flexibles (excluye ahorro/fijos/familia).
    const consumedByCategory = budgetData.consumedByCategory || {}
    const budgetItemsByCat = {}
    for (const it of budgetData.items || []) {
        if (!budgetItemsByCat[it.categoryName]) budgetItemsByCat[it.categoryName] = []
        budgetItemsByCat[it.categoryName].push(it)
    }

    // Los MOVIMIENTOS (extras) también gastan dinero y consumen presupuesto:
    // - si el movimiento coincide (por nombre) con una categoría, descuenta esa categoría;
    // - si no tiene categoría (o no coincide con ninguna), cae en el bote "sin categoría"
    //   (lo no presupuestado del sueldo), que también es parte de PUEDO GASTAR.
    // Los egresos restan y los ingresos suman. Se excluyen los ligados a ahorros.
    const normName = (s) => String(s || '').trim().toLowerCase()
    const catByName = new Map(nonVirtual.map(c => [normName(c.name), c]))
    const extrasSpentByCat = {}
    let uncategorizedExpense = 0
    let uncategorizedIncome = 0
    let uncategorizedSavings = 0
    for (const e of (obj.extras || [])) {
        if (e.linkedSavingsId) continue
        const amt = e.amount || 0
        const signed = (e.type === 'income' ? -1 : 1) * amt
        const key = normName(e.categoryName)
        if (key && catByName.has(key)) {
            extrasSpentByCat[key] = (extrasSpentByCat[key] || 0) + signed
        } else if (e.type === 'income') {
            uncategorizedIncome += amt
        } else if (e.savingsDepositId) {
            uncategorizedSavings += amt
        } else {
            uncategorizedExpense += amt
        }
    }

    for (const cat of nonVirtual) {
        const cashSpent = (cat.items || [])
            .filter(it => !isCreditItem(it))
            .reduce((a, it) => a + (it.paidAmount || 0), 0)
        const creditInCat = (cat.items || [])
            .filter(isCreditItem)
            .reduce((a, it) => a + (it.budgetedAmount || 0), 0)
        const purchasesConsumed = consumedByCategory[cat.name] || 0
        const extrasForCat = extrasSpentByCat[normName(cat.name)] || 0
        const budget = categoryBudget(cat)
        const spent = r2(cashSpent + creditInCat + purchasesConsumed + extrasForCat)
        cat.categoryBudget = r2(budget)
        cat.spent = spent
        cat.creditConsumed = r2(creditInCat + purchasesConsumed)
        cat.remaining = r2(budget - spent)
        cat.flexible = !!cat.flexible
        cat.protected = !!cat.protected
        // Compras de tarjeta (propias) asignadas a esta categoría este mes de presupuesto.
        cat.creditBudgetItems = budgetItemsByCat[cat.name] || []
    }
    // PUEDO GASTAR = lo que sobra en las categorías que el usuario marcó como "de gasto"
    // (flexible) + el bote "sin categoría" (sueldo no presupuestado − movimientos sin
    // categoría). Puede quedar NEGATIVO si se gasta de más (es intencional).
    const unbudgeted = Math.max(0, r2(obj.salary - budgeted))
    const sinCatSpent = r2(uncategorizedExpense + uncategorizedSavings - uncategorizedIncome)
    const sinCatRemaining = r2(unbudgeted - uncategorizedExpense - uncategorizedSavings + uncategorizedIncome)
    const flexibleRemaining = nonVirtual
        .filter(c => c.flexible && c.kind !== 'savings')
        .reduce((a, c) => a + c.remaining, 0)
    const flexibleCount = nonVirtual.filter(c => c.flexible && c.kind !== 'savings').length
    const puedoGastar = r2(flexibleRemaining + sinCatRemaining)

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

    const base = obj.salary - paid - extrasExpense + extrasIncome + withdrawalsForBalance + paidFromSavingsNet + paidByBorrowerNet + paidFromCardNet + paidFromTransferNet
    const realBalance = base - creditPaidAmt - balancePendingTotal
    const availableBalance = base - paidByBorrowerNet - (creditTotal - sharedShare) - balancePendingTotal

    // ----- Fase 1: desglose de la factura del mes por tarjeta -----
    const Card = require('../card/model')
    const cards = await Card.find({ userId }).lean()
    const cardMap = new Map(cards.map(c => [String(c._id), c]))
    const usageMap = {}
    {
        const allPurchases = await require('../creditPurchase/model').find({ userId }).lean()
        for (const p of allPurchases) {
            const key = String(p.cardId || 'none')
            for (const c of p.cuotas) {
                if (!c.isPaid) usageMap[key] = (usageMap[key] || 0) + (c.amount - (c.paidAmount || 0))
            }
        }
    }
    const breakdownMap = new Map()
    const bucket = (cardId) => {
        const key = cardId ? String(cardId) : 'none'
        let b = breakdownMap.get(key)
        if (!b) {
            const meta = cardId ? cardMap.get(String(cardId)) : null
            b = {
                cardId: cardId ? String(cardId) : null,
                name: meta ? meta.name : 'Sin tarjeta',
                color: meta ? (meta.color || '#94a3b8') : '#94a3b8',
                bank: meta ? (meta.bank || '') : '',
                creditLimit: meta ? (meta.creditLimit || 0) : 0,
                used: r2(usageMap[key] || 0),
                total: 0, mine: 0, others: 0
            }
            breakdownMap.set(key, b)
        }
        return b
    }
    for (const c of [...tdc, ...diferidos]) {
        const b = bucket(c.cardId)
        b.total += c.budgetedAmount
        if (c.isShared) b.others += c.budgetedAmount
        else b.mine += c.budgetedAmount
    }
    for (const ext of externalCreditItems) {
        const b = bucket(ext.cardId || null)
        b.total += ext.amount
        b.mine += ext.amount
    }
    const cardsBreakdown = [...breakdownMap.values()].map(b => ({
        ...b,
        total: r2(b.total),
        mine: r2(b.mine),
        others: r2(b.others),
        available: b.creditLimit > 0 ? r2(Math.max(0, b.creditLimit - b.used)) : 0
    }))

    obj.summary = {
        totalBudgeted: budgeted,
        totalPaid: paid,
        totalExtras: r2(extrasExpense - savingsExtrasTotal),
        totalExtrasIncome: extrasIncome,
        remainingSalary: realBalance,
        availableBalance: availableBalance,
        availableToBudget: obj.salary - budgeted,
        pendingLoansTotal,
        // Fase 2/3
        puedoGastar,
        flexibleCount,
        unbudgeted,
        // Bote "sin categoría": lo no presupuestado, con sus movimientos sin categoría.
        sinCategoria: {
            budget: unbudgeted,
            income: r2(uncategorizedIncome),
            expense: r2(uncategorizedExpense),
            savings: r2(uncategorizedSavings),
            spent: sinCatSpent,
            remaining: sinCatRemaining
        },
        apartado: budgetData.apartado || 0,
        retainedFromPrev: budgetData.retainedFromPrev || 0,
        // Saldo realmente libre: quita lo que aparto este mes y suma lo que retuve antes
        // (ese dinero ya está en la cuenta para pagar la tarjeta de este mes).
        disponibleReal: r2(availableBalance - (budgetData.apartado || 0) + (budgetData.retainedFromPrev || 0)),
        porPagar: r2(creditTotal),
        cardsBreakdown,
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
        if (extra.linkedSavingsId) {
            throw myError('Este ingreso proviene de un egreso de ahorros. Gestiónalo desde el movimiento de ahorros.', 400)
        }
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
        flexible: !!cat.flexible,
        protected: !!cat.protected,
        items: (cat.items || []).map(it => ({
            name: it.name,
            budgetedAmount: it.amount || 0,
            isPaid: false,
            paidAmount: 0,
            paidAt: null,
            paymentMethod: it.paymentMethod === 'credit' ? 'credit' : 'cash',
            cardId: it.paymentMethod === 'credit' ? (it.cardId || null) : null
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
            flexible: !!cat.flexible,
            protected: !!cat.protected,
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
                        paymentMethod: 'credit',
                        cardId: it.cardId || prev?.cardId || null
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

        if (amt === 0) {
            // Eliminar todos los movimientos vinculados a este item (limpia duplicados accidentales)
            await SavingsMovement.deleteMany({ userId, monthlyStatementId: stmt._id, 'itemRef.itemId': item._id })
        } else if (savingsAcc) {
            // Upsert atómico: si existe uno lo actualiza, si no lo crea — previene duplicados por requests simultáneos
            await SavingsMovement.findOneAndUpdate(
                { userId, monthlyStatementId: stmt._id, 'itemRef.itemId': item._id },
                {
                    $set: {
                        accountId: savingsAcc._id,
                        type: 'deposit',
                        amount: amt,
                        description: `${cat.name} / ${item.name}`,
                        date: new Date(stmt.year, stmt.month - 1, new Date().getDate())
                    },
                    $setOnInsert: {
                        userId,
                        monthlyStatementId: stmt._id,
                        itemRef: { categoryId: cat._id, itemId: item._id }
                    }
                },
                { upsert: true }
            )
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
    if (logAction) await log(userId, stmt.year, stmt.month, logAction, logDesc, amt || null,
        { statementId: id, categoryId: String(cat._id), itemId: String(item._id) })

    return buildEnrichedStatement(stmt, userId)
}

async function addExtra(userId, id, data) {
    const stmt = await Statement.findOne({ _id: id, userId })
    if (!stmt) throw myError('Statement not found', 404)
    stmt.extras.push(data)
    await stmt.save()
    const savedExtra = stmt.extras[stmt.extras.length - 1]
    const typeLabel = data.type === 'income' ? 'Ingreso extra' : 'Gasto extra'
    await log(userId, stmt.year, stmt.month, 'extra_added',
        `${typeLabel}: ${data.name} $${Number(data.amount).toFixed(2)}`, data.amount,
        { statementId: id, extraId: String(savedExtra._id) })
    return buildEnrichedStatement(stmt, userId)
}

// Crear un AHORRO desde el mes: mueve dinero a la cuenta de ahorros (depósito) y lo
// descuenta de su origen — una categoría (categoryId) o el bote "sin categoría" (sin id).
// El movimiento-gasto vinculado reduce el disponible y el restante del origen; el depósito
// suma a ahorros. Borrar el movimiento revierte ambos.
async function createSavings(userId, id, { amount, name, categoryId }) {
    const stmt = await Statement.findOne({ _id: id, userId })
    if (!stmt) throw myError('Statement not found', 404)
    const amt = r2(amount)
    if (amt <= 0) throw myError('Monto inválido', 400)

    let categoryName = ''
    if (categoryId) {
        const cat = stmt.categories.id(categoryId)
        if (!cat) throw myError('Categoría no encontrada', 404)
        categoryName = cat.name
    }

    let savingsAcc = await Account.findOne({ userId, type: 'savings' })
    if (!savingsAcc) {
        const accountController = require('../account/controller')
        await accountController.bootstrap(userId)
        savingsAcc = await Account.findOne({ userId, type: 'savings' })
    }
    if (!savingsAcc) throw myError('Cuenta de ahorros no encontrada', 404)

    const depositDate = new Date(stmt.year, stmt.month - 1, Math.min(new Date().getDate(), 28), 12)
    const label = (name || '').trim() || 'Ahorro'
    const deposit = await SavingsMovement.create({
        userId,
        accountId: savingsAcc._id,
        type: 'deposit',
        amount: amt,
        description: `${label}${categoryName ? ' de ' + categoryName : ''}`,
        monthlyStatementId: stmt._id,
        fromMonthExtra: true,
        date: depositDate
    })

    stmt.extras.push({
        name: label,
        amount: amt,
        type: 'expense',
        categoryName,
        savingsDepositId: deposit._id,
        date: depositDate
    })
    await stmt.save()
    await log(userId, stmt.year, stmt.month, 'savings_added',
        `Ahorro $${amt.toFixed(2)}${categoryName ? ' desde ' + categoryName : ''}`, amt)
    return buildEnrichedStatement(stmt, userId)
}

async function removeExtra(userId, id, extraId) {
    const stmt = await Statement.findOne({ _id: id, userId })
    if (!stmt) throw myError('Statement not found', 404)
    const extra = stmt.extras.id(extraId)
    if (!extra) throw myError('Extra no encontrado', 404)
    const extraName = extra.name
    const extraAmount = extra.amount
    // Si el ingreso proviene de un egreso de ahorros, borrar también el movimiento
    // vinculado para devolver el monto a la cuenta de ahorros.
    if (extra.linkedSavingsId) {
        await SavingsMovement.deleteOne({ _id: extra.linkedSavingsId, userId })
    }
    // Si el movimiento es un AHORRO, borrar el depósito vinculado (revierte ahorros).
    if (extra.savingsDepositId) {
        await SavingsMovement.deleteOne({ _id: extra.savingsDepositId, userId })
    }
    extra.deleteOne()
    await stmt.save()
    await log(userId, stmt.year, stmt.month, 'extra_deleted',
        `Eliminado: ${extraName} $${Number(extraAmount).toFixed(2)}`, extraAmount)
    return buildEnrichedStatement(stmt, userId)
}

async function addItemToCategory(userId, id, categoryId, { name, budgetedAmount, paymentMethod, cardId, paid }) {
    const stmt = await Statement.findOne({ _id: id, userId })
    if (!stmt) throw myError('Statement not found', 404)

    const cat = stmt.categories.id(categoryId)
    if (!cat) throw myError('Categoría no encontrada', 404)

    const amount = Number(budgetedAmount) || 0
    if (amount < 0) throw myError('Monto inválido', 400)

    // Un movimiento marcado como pagado (paid) es gasto real: la validación de sobregiro
    // la hace el front por "restante gastado" (con compensación), no por suma de items.
    if (!paid) {
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
    }

    const pm = paymentMethod === 'credit' ? 'credit' : 'cash'
    const groupPaid = !!(stmt.creditState && stmt.creditState.tdcPaid)
    const startsPaid = pm === 'credit' && groupPaid
    let resolvedCard = null
    if (pm === 'credit') {
        const card = await cardController.ensureDefaultCard(userId)
        resolvedCard = cardId ? cardId : (card ? card._id : null)
    }
    cat.items.push({
        name,
        budgetedAmount: amount,
        isPaid: startsPaid,
        paidAmount: startsPaid ? amount : 0,
        paidAt: startsPaid ? new Date() : null,
        paymentMethod: pm,
        cardId: resolvedCard
    })
    await stmt.save()
    const pmLabel = pm === 'credit' ? ' (tarjeta)' : ''
    await log(userId, stmt.year, stmt.month, 'item_added',
        `Item añadido: ${name} (${cat.name})${pmLabel} $${amount.toFixed(2)}`, amount)

    // Movimiento rápido: marcar el item como gastado de una vez (solo cash).
    // Reutiliza setItemAmount para que la sincronización con ahorros funcione igual.
    if (paid && pm === 'cash' && amount > 0) {
        const newItem = cat.items[cat.items.length - 1]
        return setItemAmount(userId, id, { categoryId, itemId: String(newItem._id), amount })
    }
    return buildEnrichedStatement(stmt, userId)
}

// Cambiar la tarjeta de un item pagado con tarjeta (paymentMethod: 'credit').
async function updateItemCard(userId, id, categoryId, itemId, { cardId }) {
    const stmt = await Statement.findOne({ _id: id, userId })
    if (!stmt) throw myError('Statement not found', 404)
    const cat = stmt.categories.id(categoryId)
    if (!cat) throw myError('Categoría no encontrada', 404)
    const item = cat.items.id(itemId)
    if (!item) throw myError('Item no encontrado', 404)
    if (cardId) {
        const Card = require('../card/model')
        const card = await Card.findOne({ _id: cardId, userId })
        if (!card) throw myError('Tarjeta no encontrada', 404)
        item.cardId = card._id
    } else {
        item.cardId = null
    }
    await stmt.save()
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
    if (data.flexible !== undefined) cat.flexible = !!data.flexible
    if (data.protected !== undefined) cat.protected = !!data.protected
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

// Fase 4: compensar un sobregiro moviendo presupuesto de una categoría (con
// presupuesto fijo/envelope) a otra. Nunca deja que un exceso se absorba en silencio.
async function compensate(userId, id, { fromCategoryId, toCategoryId, amount }) {
    const stmt = await Statement.findOne({ _id: id, userId })
    if (!stmt) throw myError('Statement not found', 404)

    const from = stmt.categories.id(fromCategoryId)
    const to = stmt.categories.id(toCategoryId)
    if (!from || !to) throw myError('Categoría no encontrada', 404)
    if (String(from._id) === String(to._id)) throw myError('Elige una categoría distinta', 400)

    const amt = r2(amount)
    if (amt <= 0) throw myError('Monto inválido', 400)

    if (!(from.totalAmount > 0)) {
        throw myError(`"${from.name}" no tiene un presupuesto fijo del que compensar.`, 400)
    }
    const fromUsed = sumItems(from)
    const fromFree = from.totalAmount - fromUsed
    if (amt > fromFree + 0.001) {
        throw myError(`"${from.name}" solo tiene ${fromFree.toFixed(2)} libre para compensar.`, 400)
    }

    from.totalAmount = r2(from.totalAmount - amt)
    if (to.totalAmount > 0) {
        to.totalAmount = r2(to.totalAmount + amt)
    } else {
        // La categoría destino presupuesta por suma de items: fijamos un total = items + refuerzo.
        to.totalAmount = r2(sumItems(to) + amt)
    }

    await stmt.save()
    await log(userId, stmt.year, stmt.month, 'budget_compensated',
        `Compensado $${amt.toFixed(2)}: ${from.name} → ${to.name}`, amt)
    return buildEnrichedStatement(stmt, userId)
}

// Fase 3: mandar parte (o todo) lo NO presupuestado a una categoría, subiendo su
// presupuesto. Así ese dinero queda marcado como "puedo gastar" en esa categoría.
async function allocateToCategory(userId, id, { toCategoryId, amount, newCategoryName }) {
    const stmt = await Statement.findOne({ _id: id, userId })
    if (!stmt) throw myError('Statement not found', 404)
    const amt = r2(amount)
    if (amt <= 0) throw myError('Monto inválido', 400)

    const budgeted = totalBudgeted(stmt.categories)
    const unbudgeted = r2(stmt.salary - budgeted)
    if (amt > unbudgeted + 0.001) {
        throw myError(`Solo tienes ${unbudgeted.toFixed(2)} sin presupuestar.`, 400)
    }

    let targetName
    const newName = (newCategoryName || '').trim()
    if (newName) {
        // Crear una categoría nueva (flexible) con este presupuesto.
        stmt.categories.push({ name: newName, kind: 'expense', totalAmount: amt, flexible: true, items: [] })
        targetName = newName
    } else {
        const to = stmt.categories.id(toCategoryId)
        if (!to) throw myError('Categoría no encontrada', 404)
        to.totalAmount = to.totalAmount > 0 ? r2(to.totalAmount + amt) : r2(sumItems(to) + amt)
        targetName = to.name
    }

    await stmt.save()
    await log(userId, stmt.year, stmt.month, 'budget_allocated',
        `Presupuestado $${amt.toFixed(2)} → ${targetName}`, amt)
    return buildEnrichedStatement(stmt, userId)
}

// Saldo real actual de la cuenta de ahorros (initialBalance + Σ movimientos).
async function currentSavingsBalance(userId) {
    const acc = await Account.findOne({ userId, type: 'savings' })
    if (!acc) return 0
    const movs = await SavingsMovement.find({ userId })
    const sum = movs.reduce((a, m) => a + (m.type === 'deposit' ? m.amount : -m.amount), 0)
    return r2((acc.initialBalance || 0) + sum)
}

// Fase 4: cerrar el mes. Ancla el saldo de ahorros para que el saldo final de un mes
// sea exactamente el inicial del siguiente, y guarda el resumen del cierre.
async function close(userId, id) {
    const stmt = await Statement.findOne({ _id: id, userId })
    if (!stmt) throw myError('Statement not found', 404)

    const enriched = await buildEnrichedStatement(stmt, userId)
    const savingsEnd = await currentSavingsBalance(userId)
    const deposits = enriched.summary.savings.monthDeposits || 0
    const withdrawals = enriched.summary.savings.monthWithdrawals || 0
    const netSavings = r2(deposits - withdrawals)

    // savingsStart: fin del mes previo cerrado; si no hay, reconstrucción (fin − neto).
    const prev = await Statement.findOne({
        userId,
        'closing.closedAt': { $ne: null },
        $or: [
            { year: { $lt: stmt.year } },
            { year: stmt.year, month: { $lt: stmt.month } }
        ]
    }).sort({ year: -1, month: -1 })
    const savingsStart = (prev && prev.closing) ? r2(prev.closing.savingsEnd) : r2(savingsEnd - netSavings)

    const overspent = (enriched.categories || [])
        .filter(c => !c.isVirtual && c.kind !== 'savings' && c.remaining < -0.001)
        .map(c => ({ name: c.name, budget: c.categoryBudget, spent: c.spent, over: r2(-c.remaining) }))

    stmt.closing = {
        closedAt: new Date(),
        savingsStart,
        savingsEnd,
        netSavings,
        apartadoCarried: enriched.summary.apartado || 0,
        overspent
    }
    await stmt.save()
    await log(userId, stmt.year, stmt.month, 'month_closed',
        `Mes cerrado. Ahorro neto $${netSavings.toFixed(2)} · Apartado $${(enriched.summary.apartado || 0).toFixed(2)}`, netSavings)
    return buildEnrichedStatement(stmt, userId)
}

async function reopen(userId, id) {
    const stmt = await Statement.findOne({ _id: id, userId })
    if (!stmt) throw myError('Statement not found', 404)
    stmt.closing = null
    await stmt.save()
    await log(userId, stmt.year, stmt.month, 'month_reopened', 'Mes reabierto', null)
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
    addExtra, removeExtra, createSavings,
    addItemToCategory, removeItemFromCategory, updateItemCard, updateCategoryMeta,
    toggleCreditGroup,
    convertMovement,
    compensate,
    allocateToCategory,
    close, reopen,
    remove
}
