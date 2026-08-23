const router = require('express').Router()

const auth = require('../components/auth/routes')
const user = require('../components/user/routes')
const accounts = require('../components/account/routes')
const cards = require('../components/card/routes')
const budgetTemplate = require('../components/budgetTemplate/routes')
const monthlyStatements = require('../components/monthlyStatement/routes')
const savingsMovements = require('../components/savingsMovement/routes')
const purchases = require('../components/creditPurchase/routes')
const loans = require('../components/loan/routes')
const activityLogs = require('../components/activityLog/routes')

function routerApp(app) {
    app.use('/api', router)
    router.use('/auth', auth)
    router.use('/user', user)
    router.use('/accounts', accounts)
    router.use('/cards', cards)
    router.use('/budget-template', budgetTemplate)
    router.use('/monthly-statements', monthlyStatements)
    router.use('/savings-movements', savingsMovements)
    router.use('/purchases', purchases)
    router.use('/loans', loans)
    router.use('/activity-logs', activityLogs)
}

module.exports = routerApp
