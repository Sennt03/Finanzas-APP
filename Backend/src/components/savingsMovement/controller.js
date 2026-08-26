const SavingsMovement = require('./model')
const Account = require('../account/model')
const Statement = require('../monthlyStatement/model')
const myError = require('../../libs/myError')

async function list(userId) {
    return SavingsMovement.find({ userId }).sort({ date: -1, createdAt: -1 })
}

async function create(userId, data) {
    // Fase 4: el ahorro es una categoría protegida. Un retiro manual siempre exige
    // un motivo escrito, que queda en el historial de movimientos.
    if (data.type === 'withdrawal' && !(data.description || '').trim()) {
        throw myError('Un retiro de ahorros requiere un motivo escrito.', 400)
    }

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

    const mov = await SavingsMovement.create({
        userId,
        accountId: savingsAcc._id,
        type: data.type,
        amount: data.amount,
        description: data.description || '',
        monthlyStatementId: data.monthlyStatementId || null,
        date: data.date || new Date()
    })

    // Un egreso de ahorros entra como dinero a la cuenta transaccional del mes:
    // registramos el ingreso vinculado en el estado de cuenta de ese mes para que
    // sea visible y se mantenga sincronizado al borrar (desde aquí o desde el mes).
    if (mov.type === 'withdrawal') {
        const d = mov.date
        const stmt = await Statement.findOne({ userId, year: d.getFullYear(), month: d.getMonth() + 1 })
        if (stmt) {
            stmt.extras.push({
                name: (mov.description || '').trim() || 'Retiro de ahorros',
                amount: mov.amount,
                type: 'income',
                categoryName: 'Ahorros',
                linkedSavingsId: mov._id,
                date: mov.date
            })
            await stmt.save()
            if (!mov.monthlyStatementId) {
                mov.monthlyStatementId = stmt._id
                await mov.save()
            }
        }
    }

    return mov
}

async function remove(userId, id) {
    const mov = await SavingsMovement.findOne({ _id: id, userId })
    if (!mov) throw myError('Movimiento no encontrado', 404)
    // Bloquear borrado de movimientos auto-generados desde items pagados
    if (mov.itemRef?.itemId) {
        throw myError('Este movimiento se generó al marcar un item como pagado. Desmárcalo desde el estado de cuenta.', 400)
    }
    // Bloquear borrado de depósitos generados por un movimiento "Ahorro" del mes
    if (mov.fromMonthExtra) {
        throw myError('Este ahorro se creó desde un mes. Elimínalo desde el movimiento en ese mes.', 400)
    }
    // Si el egreso registró un ingreso vinculado en el mes, quitarlo también
    if (mov.type === 'withdrawal' && mov.monthlyStatementId) {
        const stmt = await Statement.findOne({ _id: mov.monthlyStatementId, userId })
        if (stmt) {
            const linked = stmt.extras.find(e => e.linkedSavingsId && String(e.linkedSavingsId) === String(mov._id))
            if (linked) {
                linked.deleteOne()
                await stmt.save()
            }
        }
    }
    await mov.deleteOne()
    return { _id: id }
}

module.exports = { list, create, remove }
