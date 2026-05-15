const router = require('express').Router()

const auth = require('../components/auth/routes')
const user = require('../components/user/routes')
const accounts = require('../components/account/routes')
const budgetTemplate = require('../components/budgetTemplate/routes')
const monthlyStatements = require('../components/monthlyStatement/routes')
const savingsMovements = require('../components/savingsMovement/routes')
const purchases = require('../components/creditPurchase/routes')

function routerApp(app) {
    app.use('/api', router)
    router.use('/auth', auth)
    router.use('/user', user)
    router.use('/accounts', accounts)
    router.use('/budget-template', budgetTemplate)
    router.use('/monthly-statements', monthlyStatements)
    router.use('/savings-movements', savingsMovements)
    router.use('/purchases', purchases)
}

module.exports = routerApp
