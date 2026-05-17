const ActivityLog = require('./model')
const myError = require('../../libs/myError')

function isDeletable(entry) {
    const meta = entry.metadata || {}
    if (['item_paid', 'item_partial'].includes(entry.action)) {
        return !!(meta.statementId && meta.categoryId && meta.itemId)
    }
    if (entry.action === 'extra_added') {
        return !!(meta.statementId && meta.extraId)
    }
    if (entry.action === 'loan_created') {
        return !!(meta.loanId)
    }
    return false
}

async function listByMonth(userId, year, month) {
    const entries = await ActivityLog.find({ userId, year: Number(year), month: Number(month) })
        .sort({ createdAt: -1 })
        .lean()
    return entries.map(e => ({ ...e, deletable: isDeletable(e) }))
}

async function remove(userId, id) {
    const entry = await ActivityLog.findOne({ _id: id, userId })
    if (!entry) throw myError('Entrada no encontrada', 404)

    const meta = entry.metadata || {}

    if (['item_paid', 'item_partial'].includes(entry.action)) {
        if (!meta.statementId || !meta.categoryId || !meta.itemId) {
            throw myError('No se puede deshacer esta entrada (sin referencia)', 400)
        }
        const Statement = require('../monthlyStatement/model')
        const SavingsMovement = require('../savingsMovement/model')
        const stmt = await Statement.findOne({ _id: meta.statementId, userId })
        if (stmt) {
            const cat = stmt.categories.id(meta.categoryId)
            if (cat) {
                const item = cat.items.id(meta.itemId)
                if (item) {
                    item.paidAmount = 0
                    item.isPaid = false
                    item.paidAt = null
                    if (cat.kind === 'savings') {
                        await SavingsMovement.deleteMany({
                            userId,
                            monthlyStatementId: stmt._id,
                            'itemRef.itemId': item._id
                        })
                    }
                    await stmt.save()
                }
            }
        }
    } else if (entry.action === 'extra_added') {
        if (!meta.statementId || !meta.extraId) {
            throw myError('No se puede deshacer esta entrada (sin referencia)', 400)
        }
        const Statement = require('../monthlyStatement/model')
        const stmt = await Statement.findOne({ _id: meta.statementId, userId })
        if (stmt) {
            const extra = stmt.extras.id(meta.extraId)
            if (extra) {
                extra.deleteOne()
                await stmt.save()
            }
        }
    } else if (entry.action === 'loan_created') {
        if (!meta.loanId) {
            throw myError('No se puede deshacer esta entrada (sin referencia)', 400)
        }
        const Loan = require('../loan/model')
        const loan = await Loan.findOne({ _id: meta.loanId, userId })
        if (loan) {
            if (loan.status !== 'pending') throw myError('No se puede eliminar: el préstamo ya fue cobrado o transferido', 400)
            if (loan.fromSavings) throw myError('No se puede eliminar un préstamo cubierto por ahorros', 400)
            if (loan.fromCard) throw myError('No se puede eliminar un préstamo de tarjeta directamente', 400)
            await loan.deleteOne()
        }
    } else {
        throw myError('Este movimiento no se puede deshacer desde el historial', 400)
    }

    await entry.deleteOne()
    return { _id: id }
}

module.exports = { listByMonth, remove }
