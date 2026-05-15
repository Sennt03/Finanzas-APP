const CreditPurchase = require('./model')
const Template = require('../budgetTemplate/model')
const myError = require('../../libs/myError')

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

async function list(userId) {
    return CreditPurchase.find({ userId }).sort({ purchaseDate: -1 })
}

async function findCuotasForMonth(userId, year, month) {
    const purchases = await CreditPurchase.find({ userId })
    const tdc = []
    const diferidos = []

    for (const p of purchases) {
        for (let idx = 0; idx < p.cuotas.length; idx++) {
            const c = p.cuotas[idx]
            if (c.year === year && c.month === month) {
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
                    cuotaId: c._id
                }
                if (p.installments > 1) diferidos.push(display)
                else tdc.push(display)
            }
        }
    }

    return { tdc, diferidos }
}

async function create(userId, { name, totalAmount, purchaseDate, installments }) {
    const tpl = await Template.findOne({ userId })
    const cutoffDay = tpl?.cutoffDay || 12
    const inst = installments && installments > 0 ? Math.floor(installments) : 1
    const cuotas = calculateCuotas(purchaseDate, inst, totalAmount, cutoffDay)
    return CreditPurchase.create({
        userId,
        name,
        totalAmount,
        purchaseDate,
        installments: inst,
        cutoffDayUsed: cutoffDay,
        cuotas
    })
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
    setCuotaAmount,
    remove
}
