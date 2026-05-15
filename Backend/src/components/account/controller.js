const Account = require('./model')
const SavingsMovement = require('../savingsMovement/model')
const MonthlyStatement = require('../monthlyStatement/model')
const CreditPurchase = require('../creditPurchase/model')
const myError = require('../../libs/myError')

async function bootstrap(userId) {
    const existing = await Account.find({ userId })
    if (existing.length > 0) return existing

    const accounts = await Account.insertMany([
        { userId, name: 'Banco Pichincha', type: 'transactional', initialBalance: 0 },
        { userId, name: 'Produbanco', type: 'savings', initialBalance: 0 }
    ])
    return accounts
}

async function list(userId) {
    let accounts = await Account.find({ userId }).lean()
    if (accounts.length === 0) {
        await bootstrap(userId)
        accounts = await Account.find({ userId }).lean()
    }
    return Promise.all(accounts.map(async (acc) => {
        const balances = await computeBalances(acc)
        return { ...acc, ...balances }
    }))
}

async function update(userId, id, data) {
    const account = await Account.findOne({ _id: id, userId })
    if (!account) throw myError('Account not found', 404)

    if (data.name !== undefined) account.name = data.name
    if (data.initialBalance !== undefined && account.type === 'savings') {
        account.initialBalance = data.initialBalance
    }
    await account.save()
    const balances = await computeBalances(account)
    return { ...account.toObject(), ...balances }
}

async function computeBalances(account) {
    if (account.type === 'savings') {
        const movs = await SavingsMovement.find({ userId: account.userId })
        const sum = movs.reduce((acc, m) => acc + (m.type === 'deposit' ? m.amount : -m.amount), 0)
        const total = account.initialBalance + sum
        return { balance: total, availableBalance: total }
    }

    const now = new Date()
    const year = now.getFullYear()
    const month = now.getMonth() + 1
    const stmt = await MonthlyStatement.findOne({ userId: account.userId, year, month })
    if (!stmt) return { balance: 0, availableBalance: 0 }

    let paid = 0
    for (const cat of stmt.categories) {
        for (const it of cat.items) {
            paid += it.paidAmount || 0
        }
    }
    const extrasExpense = (stmt.extras || [])
        .filter(e => (e.type || 'expense') === 'expense')
        .reduce((s, e) => s + (e.amount || 0), 0)
    const extrasIncome = (stmt.extras || [])
        .filter(e => e.type === 'income')
        .reduce((s, e) => s + (e.amount || 0), 0)

    const withdrawalsThisMonth = await SavingsMovement.find({
        userId: account.userId, type: 'withdrawal',
        date: { $gte: new Date(year, month - 1, 1), $lt: new Date(year, month, 1) }
    })
    const wSum = withdrawalsThisMonth.reduce((s, m) => s + m.amount, 0)

    // TDC/diferidos del mes
    const purchases = await CreditPurchase.find({ userId: account.userId })
    let tdcTotal = 0, tdcPaid = 0, difTotal = 0, difPaid = 0
    const cs = stmt.creditState || {}
    for (const p of purchases) {
        const isDif = p.installments > 1
        for (const c of p.cuotas) {
            if (c.year === year && c.month === month) {
                if (isDif) {
                    difTotal += c.amount
                    if (cs.diferidosPaid) difPaid += c.amount
                } else {
                    tdcTotal += c.amount
                    if (cs.tdcPaid) tdcPaid += c.amount
                }
            }
        }
    }

    const base = stmt.salary - paid - extrasExpense + extrasIncome + wSum
    const realBalance = base - tdcPaid - difPaid           // físico en el banco
    const availableBalance = base - tdcTotal - difTotal     // tecnicamente disponible

    return { balance: realBalance, availableBalance }
}

module.exports = {
    bootstrap,
    list,
    update,
    computeBalances
}
