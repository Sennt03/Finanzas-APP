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
    if (!stmt) return { balance: 0, availableBalance: 0, pendingLoansTotal: 0, puedoGastar: 0, saldoEnCuenta: 0 }

    // Fuente única de verdad: el resumen enriquecido del mes (evita duplicar la lógica de
    // saldos/tarjeta y mantenerla en sync con buildEnrichedStatement).
    const msCtrl = require('../monthlyStatement/controller')
    const enriched = await msCtrl.getOne(account.userId, stmt._id)
    const s = enriched.summary
    return {
        balance: s.saldoEnCuenta,
        availableBalance: s.availableBalance,
        pendingLoansTotal: s.pendingLoansTotal,
        puedoGastar: s.puedoGastar,
        saldoEnCuenta: s.saldoEnCuenta
    }
}

module.exports = {
    bootstrap,
    list,
    update,
    computeBalances
}
