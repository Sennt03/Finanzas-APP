const ActivityLog = require('./model')

async function listByMonth(userId, year, month) {
    return ActivityLog.find({ userId, year: Number(year), month: Number(month) })
        .sort({ createdAt: -1 })
        .lean()
}

module.exports = { listByMonth }
