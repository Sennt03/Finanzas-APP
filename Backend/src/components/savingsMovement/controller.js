const SavingsMovement = require('./model')
const Account = require('../account/model')
const Statement = require('../monthlyStatement/model')
const myError = require('../../libs/myError')

async function list(userId) {
    return SavingsMovement.find({ userId }).sort({ date: -1, createdAt: -1 })
}

async function create(userId, data) {
    let savingsAcc = await Account.findOne({ userId, type: 'savings' })
    if (!savingsAcc) {
        const accountController = require('../account/controller')
        await accountController.bootstrap(userId)
        savingsAcc = await Account.findOne({ userId, type: 'savings' })
    }
    if (!savingsAcc) throw myError('Cuenta de ahorros no encontrada', 404)

    // Si tiene monthlyStatementId, validar que pertenece al usuario
    if (data.monthlyStatementId) {
        const stmt = await Statement.findOne({ _id: data.monthlyStatementId, userId })
        if (!stmt) throw myError('Estado de cuenta inválido', 400)
    }

    return SavingsMovement.create({
        userId,
        accountId: savingsAcc._id,
        type: data.type,
        amount: data.amount,
        description: data.description || '',
        monthlyStatementId: data.monthlyStatementId || null,
        date: data.date || new Date()
    })
}

async function remove(userId, id) {
    const mov = await SavingsMovement.findOne({ _id: id, userId })
    if (!mov) throw myError('Movimiento no encontrado', 404)
    // Bloquear borrado de movimientos auto-generados desde items pagados
    if (mov.itemRef?.itemId) {
        throw myError('Este movimiento se generó al marcar un item como pagado. Desmárcalo desde el estado de cuenta.', 400)
    }
    await mov.deleteOne()
    return { _id: id }
}

module.exports = { list, create, remove }
