const Card = require('./model')
const CreditPurchase = require('../creditPurchase/model')
const Template = require('../budgetTemplate/model')
const myError = require('../../libs/myError')

// Paleta por defecto para diferenciar tarjetas nuevas visualmente.
const PALETTE = ['#6366f1', '#f97316', '#10b981', '#a855f7', '#0ea5e9', '#ef4444', '#f59e0b']

// Garantiza que exista al menos una tarjeta. Se usa de forma perezosa (como el
// bootstrap de cuentas): si el usuario nunca creó tarjetas, creamos una por
// defecto tomando el día de corte de su template. Devuelve la tarjeta default.
async function ensureDefaultCard(userId) {
    let card = await Card.findOne({ userId }).sort({ createdAt: 1 })
    if (card) return card
    const tpl = await Template.findOne({ userId })
    card = await Card.create({
        userId,
        name: 'Mi tarjeta',
        bank: '',
        creditLimit: 0,
        cutoffDay: tpl?.cutoffDay || 12,
        paymentDay: 1,
        color: PALETTE[0],
        active: true,
        isDefault: true
    })
    return card
}

// Uso de cupo por tarjeta = suma de lo pendiente (no pagado) de todas sus cuotas.
async function computeUsage(userId) {
    const purchases = await CreditPurchase.find({ userId })
    const usage = {}
    for (const p of purchases) {
        const key = String(p.cardId || 'none')
        for (const c of p.cuotas) {
            if (!c.isPaid) {
                const remaining = c.amount - (c.paidAmount || 0)
                usage[key] = (usage[key] || 0) + remaining
            }
        }
    }
    return usage
}

async function list(userId) {
    let cards = await Card.find({ userId }).sort({ active: -1, createdAt: 1 }).lean()
    if (cards.length === 0) {
        await ensureDefaultCard(userId)
        cards = await Card.find({ userId }).sort({ active: -1, createdAt: 1 }).lean()
    }
    const usage = await computeUsage(userId)
    return cards.map(c => {
        const used = usage[String(c._id)] || 0
        const creditLimit = c.creditLimit || 0
        return {
            ...c,
            used,
            available: creditLimit > 0 ? Math.max(0, creditLimit - used) : 0
        }
    })
}

async function create(userId, data) {
    const count = await Card.countDocuments({ userId })
    const card = await Card.create({
        userId,
        name: data.name,
        bank: data.bank || '',
        creditLimit: data.creditLimit || 0,
        cutoffDay: data.cutoffDay || 12,
        paymentDay: data.paymentDay || 1,
        color: data.color || PALETTE[count % PALETTE.length],
        active: data.active !== undefined ? data.active : true
    })
    return card
}

async function update(userId, id, data) {
    const card = await Card.findOne({ _id: id, userId })
    if (!card) throw myError('Tarjeta no encontrada', 404)

    if (data.name !== undefined) card.name = data.name
    if (data.bank !== undefined) card.bank = data.bank
    if (data.creditLimit !== undefined) card.creditLimit = data.creditLimit
    if (data.cutoffDay !== undefined) card.cutoffDay = data.cutoffDay
    if (data.paymentDay !== undefined) card.paymentDay = data.paymentDay
    if (data.color !== undefined) card.color = data.color
    if (data.active !== undefined) card.active = data.active

    await card.save()
    return card
}

async function remove(userId, id) {
    const card = await Card.findOne({ _id: id, userId })
    if (!card) throw myError('Tarjeta no encontrada', 404)

    const inUse = await CreditPurchase.countDocuments({ userId, cardId: id })
    if (inUse > 0) {
        throw myError(`No puedes eliminar esta tarjeta: tiene ${inUse} compra(s) asociada(s). Desactívala en su lugar.`, 400)
    }
    const total = await Card.countDocuments({ userId })
    if (total <= 1) throw myError('Debes tener al menos una tarjeta.', 400)

    await card.deleteOne()
    return { _id: id }
}

module.exports = { ensureDefaultCard, list, create, update, remove }
