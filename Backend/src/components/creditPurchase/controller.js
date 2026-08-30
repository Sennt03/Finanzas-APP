const CreditPurchase = require('./model')
const Template = require('../budgetTemplate/model')
const Card = require('../card/model')
const cardController = require('../card/controller')
const myError = require('../../libs/myError')
const log = require('../../libs/activityLog')

function calculateCuotas(purchaseDate, installments, totalAmount, cutoffDay) {
    const d = new Date(purchaseDate)
    let year = d.getFullYear()
    let month = d.getMonth() + 1 // 1-12
    if (d.getDate() >= cutoffDay) {
        month += 1
        if (month > 12) { month = 1; year += 1 }
    }

    const cuotaAmount = Math.round((totalAmount / installments) * 100) / 100
    const cuotas = []
    for (let i = 0; i < installments; i++) {
        // Última cuota absorbe el redondeo
        const amount = i === installments - 1
            ? Math.round((totalAmount - cuotaAmount * (installments - 1)) * 100) / 100
            : cuotaAmount
        cuotas.push({ year, month, amount })
        month += 1
        if (month > 12) { month = 1; year += 1 }
    }
    return cuotas
}

// ¿La compra cruza el corte? (día de compra >= día de corte → se factura el mes SIGUIENTE).
// Solo si cruza el corte tiene sentido elegir retener/no retener; si se compra antes del
// corte, se factura y se paga este mismo mes → siempre "retain" (descuenta este mes).
function crossesCutoff(p) {
    if ((p.installments || 1) !== 1) return true // diferidos: cada cuota factura en un mes posterior
    const d = new Date(p.purchaseDate)
    return d.getDate() >= (p.cutoffDayUsed || 12)
}

// budgetMode efectivo: si la compra NO cruza el corte se paga este mismo mes, así que
// se fuerza 'retain' aunque el guardado sea 'defer' (no hay "mes siguiente" que diferir).
function effectiveMode(p) {
    return crossesCutoff(p) ? (p.budgetMode || 'retain') : 'retain'
}

// Mes en el que la cuota `idx` CONSUME presupuesto (Fase 2):
//   - Compra simple (1 cuota):
//       · budgetMode 'retain' (default) → mes de la FECHA DE COMPRA (retengo/aparto ahora).
//       · budgetMode 'defer'            → mes de FACTURACIÓN (consumo al pagar).
//   - Diferido (N cuotas): cada cuota consume presupuesto en su propio mes de facturación.
function budgetMonthOf(p, idx) {
    if ((p.installments || 1) === 1) {
        if (effectiveMode(p) === 'defer') {
            const c = p.cuotas[0]
            return { year: c.year, month: c.month }
        }
        const d = new Date(p.purchaseDate)
        return { year: d.getFullYear(), month: d.getMonth() + 1 }
    }
    const c = p.cuotas[idx]
    return { year: c.year, month: c.month }
}

async function list(userId) {
    return CreditPurchase.find({ userId }).sort({ purchaseDate: -1 })
}

// Cuotas que se FACTURAN (pagan) en el mes indicado. Base del pago mensual y de la
// categoría virtual de tarjeta. (Sin cambios de comportamiento salvo exponer cardId.)
async function findCuotasForMonth(userId, year, month) {
    const purchases = await CreditPurchase.find({ userId })
    const tdc = []
    const diferidos = []

    for (const p of purchases) {
        for (let idx = 0; idx < p.cuotas.length; idx++) {
            const c = p.cuotas[idx]
            if (c.year === year && c.month === month) {
                const bm = budgetMonthOf(p, idx)
                const display = {
                    _id: c._id,
                    name: p.installments > 1
                        ? `${p.name} (${idx + 1}/${p.installments})`
                        : p.name,
                    budgetedAmount: c.amount,
                    isPaid: c.isPaid,
                    paidAmount: c.paidAmount,
                    paidAt: c.paidAt,
                    purchaseId: p._id,
                    cuotaId: c._id,
                    cardId: p.cardId ? String(p.cardId) : null,
                    categoryName: p.categoryName || '',
                    budgetMode: effectiveMode(p),
                    crossesCutoff: crossesCutoff(p),
                    isShared: p.isShared || false,
                    borrowerName: p.borrowerName || '',
                    paidByBorrower: c.paidByBorrower || 0,
                    convertedToLoan: c.convertedToLoan || false,
                    // Fase 2: en qué mes se apartó / consumió presupuesto y si se paga después.
                    budgetYear: bm.year,
                    budgetMonth: bm.month,
                    billedLater: (bm.year < c.year) || (bm.year === c.year && bm.month < c.month)
                }
                if (p.installments > 1) diferidos.push(display)
                else tdc.push(display)
            }
        }
    }

    return { tdc, diferidos }
}

// Fase 2: datos por MES DE PRESUPUESTO.
//  - consumedByCategory: cuánto consumen las compras (propias, no compartidas) de cada
//    categoría en ese mes → alimenta el "gastado/queda" de la categoría y PUEDO GASTAR.
//  - apartado: plata comprometida este mes que se paga en un mes posterior (no compartida).
async function findBudgetMonthData(userId, year, month) {
    const purchases = await CreditPurchase.find({ userId })
    const consumedByCategory = {}
    const items = []
    let apartado = 0            // budgetMonth==M y se factura después → aparto ahora para el próximo mes
    let retainedFromPrev = 0    // se factura este mes pero ya se apartó en un mes anterior
    let poolConsumed = 0        // gasto de tarjeta SIN categoría, RETENIDO, consume disponible este mes
    const retainedItems = []
    const avanceItems = []      // gasto de tarjeta SIN categoría, NO retenido (defer) → categoría "Avance" este mes

    const before = (a, y, mo) => (a.year < y) || (a.year === y && a.month < mo)

    for (const p of purchases) {
        if (p.isShared) continue // consumo de tercero: no reduce mi presupuesto
        for (let idx = 0; idx < p.cuotas.length; idx++) {
            const c = p.cuotas[idx]
            const bm = budgetMonthOf(p, idx)
            const budgetIsThisMonth = bm.year === year && bm.month === month
            const billIsThisMonth = c.year === year && c.month === month
            const billedLater = (bm.year < c.year) || (bm.year === c.year && bm.month < c.month)

            if (budgetIsThisMonth) {
                const amt = c.amount
                if (billedLater) apartado += amt
                if (!p.categoryName) {
                    if (effectiveMode(p) === 'defer') {
                        // No retenido: se presupuesta como "Avance" en su mes de facturación.
                        avanceItems.push({
                            purchaseId: String(p._id),
                            cuotaId: String(c._id),
                            name: p.installments > 1 ? `${p.name} (${idx + 1}/${p.installments})` : p.name,
                            amount: amt,
                            cardId: p.cardId ? String(p.cardId) : null,
                            isPaid: !!c.isPaid,
                            billYear: c.year,
                            billMonth: c.month
                        })
                    } else {
                        poolConsumed += amt // retenido sin categoría → reduce "disponible gastos yo"
                    }
                }
                if (p.categoryName) {
                    consumedByCategory[p.categoryName] = (consumedByCategory[p.categoryName] || 0) + amt
                    items.push({
                        purchaseId: String(p._id),
                        cuotaId: String(c._id),
                        name: p.installments > 1 ? `${p.name} (${idx + 1}/${p.installments})` : p.name,
                        amount: amt,
                        categoryName: p.categoryName,
                        cardId: p.cardId ? String(p.cardId) : null,
                        isPaid: !!c.isPaid,
                        billYear: c.year,
                        billMonth: c.month,
                        billedLater,
                        subType: p.installments > 1 ? 'diferido' : 'tdc'
                    })
                }
            }

            // Se factura este mes pero su presupuesto se consumió en un mes anterior:
            // ese dinero ya lo retuve → lo muestro como "retenido del mes anterior".
            if (billIsThisMonth && before(bm, year, month)) {
                retainedFromPrev += c.amount
                retainedItems.push({
                    purchaseId: String(p._id),
                    name: p.name,
                    amount: c.amount,
                    categoryName: p.categoryName || '',
                    budgetYear: bm.year,
                    budgetMonth: bm.month
                })
            }
        }
    }
    return {
        consumedByCategory,
        apartado: Math.round(apartado * 100) / 100,
        retainedFromPrev: Math.round(retainedFromPrev * 100) / 100,
        poolConsumed: Math.round(poolConsumed * 100) / 100,
        items,
        retainedItems,
        avanceItems
    }
}

async function resolveCard(userId, cardId) {
    if (cardId) {
        const card = await Card.findOne({ _id: cardId, userId })
        if (!card) throw myError('Tarjeta no encontrada', 404)
        return card
    }
    return cardController.ensureDefaultCard(userId)
}

async function create(userId, { name, totalAmount, purchaseDate, installments, isShared, borrowerName, cardId, categoryName, budgetMode }) {
    const card = await resolveCard(userId, cardId)
    const cutoffDay = card?.cutoffDay || (await Template.findOne({ userId }))?.cutoffDay || 12
    const inst = installments && installments > 0 ? Math.floor(installments) : 1
    const cuotas = calculateCuotas(purchaseDate, inst, totalAmount, cutoffDay)
    const purchase = await CreditPurchase.create({
        userId,
        name,
        totalAmount,
        purchaseDate,
        installments: inst,
        cutoffDayUsed: cutoffDay,
        cardId: card ? card._id : null,
        categoryName: (categoryName || '').trim(),
        budgetMode: budgetMode === 'defer' ? 'defer' : 'retain',
        cuotas,
        isShared: !!isShared,
        borrowerName: isShared ? (borrowerName || '').trim() : ''
    })
    if (purchase.cuotas.length > 0) {
        const first = purchase.cuotas[0]
        const action = inst > 1 ? 'diferido_created' : 'tdc_created'
        const label = inst > 1 ? `Diferido ${inst} cuotas` : 'Compra TDC'
        const sharedNote = isShared ? ` (prestado a ${(borrowerName || '').trim()})` : ''
        await log(userId, first.year, first.month, action,
            `${label}: ${name}${sharedNote} $${Number(totalAmount).toFixed(2)}`, totalAmount)
    }
    return purchase
}

async function payBorrowerCuota(userId, purchaseId, cuotaId, amount) {
    const p = await CreditPurchase.findOne({ _id: purchaseId, userId })
    if (!p) throw myError('Compra no encontrada', 404)
    if (!p.isShared) throw myError('Esta compra no es compartida', 400)

    const c = p.cuotas.id(cuotaId)
    if (!c) throw myError('Cuota no encontrada', 404)
    if (c.convertedToLoan) throw myError('Esta cuota ya se convirtió en préstamo', 400)

    const remaining = c.amount - (c.paidByBorrower || 0)
    const amt = Number(amount) || 0
    if (amt <= 0) throw myError('Monto inválido', 400)
    if (amt > remaining) throw myError(`No puedes cobrar más de lo pendiente ($${remaining.toFixed(2)})`, 400)

    c.paidByBorrower = (c.paidByBorrower || 0) + amt
    c.paidByBorrowerAt = new Date()
    await p.save()
    await log(userId, c.year, c.month, 'borrower_paid',
        `Cobrado a ${p.borrowerName}: ${p.name} $${amt.toFixed(2)}`, amt)
    return p
}

async function convertCuotaToLoan(userId, purchaseId, cuotaId) {
    const p = await CreditPurchase.findOne({ _id: purchaseId, userId })
    if (!p) throw myError('Compra no encontrada', 404)
    if (!p.isShared) throw myError('Esta compra no es compartida', 400)

    const c = p.cuotas.id(cuotaId)
    if (!c) throw myError('Cuota no encontrada', 404)
    if (c.convertedToLoan) throw myError('Esta cuota ya se convirtió en préstamo', 400)

    const remaining = c.amount - (c.paidByBorrower || 0)
    if (remaining <= 0) throw myError('La cuota ya fue pagada completamente', 400)

    const Statement = require('../monthlyStatement/model')
    const stmt = await Statement.findOne({ userId, year: c.year, month: c.month })
    if (!stmt) throw myError('No se encontró el mes para esta cuota', 404)

    const Loan = require('../loan/model')
    const loan = await Loan.create({
        userId,
        borrowerName: p.borrowerName,
        amount: remaining,
        lentDate: new Date(),
        originStatementId: stmt._id,
        currentStatementId: stmt._id,
        status: 'pending',
        fromCard: true,
        cardPurchaseId: p._id,
        history: [{ type: 'lent', date: new Date() }]
    })

    c.convertedToLoan = true
    await p.save()
    await log(userId, c.year, c.month, 'cuota_to_loan',
        `Cuota convertida a préstamo: ${p.name} (${p.borrowerName}) $${remaining.toFixed(2)}`, remaining)

    return { purchase: p, loan }
}

async function setCuotaAmount(userId, purchaseId, cuotaId, amount) {
    const p = await CreditPurchase.findOne({ _id: purchaseId, userId })
    if (!p) throw myError('Compra no encontrada', 404)
    const c = p.cuotas.id(cuotaId)
    if (!c) throw myError('Cuota no encontrada', 404)

    const amt = Number(amount) || 0
    if (amt < 0) throw myError('Monto inválido', 400)
    if (amt > c.amount) {
        throw myError(`No puedes registrar más de ${c.amount} en esta cuota`, 400)
    }

    c.paidAmount = amt
    if (c.amount > 0 && amt >= c.amount) {
        c.isPaid = true
        c.paidAt = c.paidAt || new Date()
    } else {
        c.isPaid = false
        c.paidAt = null
    }

    await p.save()
    return p
}

async function update(userId, id, data) {
    const p = await CreditPurchase.findOne({ _id: id, userId })
    if (!p) throw myError('Compra no encontrada', 404)

    if (data.name !== undefined) p.name = data.name
    if (data.categoryName !== undefined) p.categoryName = (data.categoryName || '').trim()
    if (data.budgetMode !== undefined) p.budgetMode = data.budgetMode === 'defer' ? 'defer' : 'retain'

    // Reasignar tarjeta: recalcula los meses de facturación con el corte de la nueva
    // tarjeta, pero solo si ninguna cuota fue pagada aún (evita descuadrar pagos).
    if (data.cardId !== undefined && String(data.cardId || '') !== String(p.cardId || '')) {
        const anyPaid = p.cuotas.some(c => c.isPaid || (c.paidAmount || 0) > 0 || (c.paidByBorrower || 0) > 0)
        const card = await resolveCard(userId, data.cardId)
        p.cardId = card ? card._id : null
        if (!anyPaid && card) {
            p.cutoffDayUsed = card.cutoffDay
            const fresh = calculateCuotas(p.purchaseDate, p.installments, p.totalAmount, card.cutoffDay)
            p.cuotas = fresh
        }
    }

    if (data.totalAmount !== undefined && data.totalAmount !== p.totalAmount) {
        const newTotal = Number(data.totalAmount)
        const cuotaAmount = Math.round((newTotal / p.installments) * 100) / 100
        for (let i = 0; i < p.cuotas.length; i++) {
            const c = p.cuotas[i]
            const amount = i === p.installments - 1
                ? Math.round((newTotal - cuotaAmount * (p.installments - 1)) * 100) / 100
                : cuotaAmount
            c.amount = amount
            if (c.isPaid) c.paidAmount = amount
        }
        p.totalAmount = newTotal
    }

    await p.save()
    return p
}

async function remove(userId, id) {
    const p = await CreditPurchase.findOne({ _id: id, userId })
    if (!p) throw myError('Compra no encontrada', 404)
    await p.deleteOne()
    return { _id: id }
}

module.exports = {
    list,
    create,
    update,
    findCuotasForMonth,
    findBudgetMonthData,
    budgetMonthOf,
    crossesCutoff,
    effectiveMode,
    calculateCuotas,
    setCuotaAmount,
    payBorrowerCuota,
    convertCuotaToLoan,
    remove
}
