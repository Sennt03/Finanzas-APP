const ActivityLog = require('../components/activityLog/model')

async function log(userId, year, month, action, description, amount = null, metadata = {}) {
    try {
        await ActivityLog.create({ userId, year, month, action, description, amount, metadata })
    } catch (e) {
        console.error('ActivityLog error:', e.message)
    }
}

module.exports = log
