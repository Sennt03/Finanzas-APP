const Template = require('./model')
const myError = require('../../libs/myError')

const DEFAULT_TEMPLATE = {
    defaultSalary: 0,
    categories: [
        {
            name: 'Gastos fijos',
            kind: 'expense',
            items: [
                { name: 'Renta', amount: 0 },
                { name: 'Servicios', amount: 0 }
            ]
        },
        {
            name: 'Tarjetas de crédito',
            kind: 'expense',
            items: []
        },
        {
            name: 'Familia',
            kind: 'expense',
            items: [
                { name: 'Dinero para mamá', amount: 0 }
            ]
        },
        {
            name: 'Ahorro',
            kind: 'savings',
            items: [
                { name: 'Ahorro mensual', amount: 0 }
            ]
        }
    ]
}

async function bootstrap(userId) {
    const existing = await Template.findOne({ userId })
    if (existing) return existing
    return Template.create({ userId, ...DEFAULT_TEMPLATE })
}

async function get(userId) {
    let tpl = await Template.findOne({ userId })
    if (!tpl) tpl = await bootstrap(userId)
    return tpl
}

async function update(userId, data) {
    const tpl = await Template.findOne({ userId })
    if (!tpl) throw myError('Template not found', 404)

    if (data.defaultSalary !== undefined) tpl.defaultSalary = data.defaultSalary
    if (data.cutoffDay !== undefined) tpl.cutoffDay = data.cutoffDay
    if (data.categories !== undefined) tpl.categories = data.categories

    const totalBudgeted = (tpl.categories || []).reduce((acc, cat) => {
        return acc + (cat.items || []).reduce((a, it) => a + (it.amount || 0), 0)
    }, 0)
    if (totalBudgeted > tpl.defaultSalary) {
        throw myError(`El total presupuestado (${totalBudgeted}) excede el sueldo default (${tpl.defaultSalary})`, 400)
    }

    await tpl.save()
    return tpl
}

module.exports = { bootstrap, get, update }
