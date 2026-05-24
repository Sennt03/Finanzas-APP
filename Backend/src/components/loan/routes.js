const router = require('express').Router()
const ctrl = require('./controller')
const { verifyToken } = require('../../middlewares/authHandlers')
const { createLoanValidator, transferValidator } = require('./validators')
const { success, error: resError } = require('../../network/response')

router.use(verifyToken)

router.get('/', async (req, res, next) => {
    try {
        const data = await ctrl.list(req.user._id)
        success(req, res, data)
    } catch (e) { next(e) }
})

router.get('/statement/:statementId', async (req, res, next) => {
    try {
        const data = await ctrl.listForStatement(req.user._id, req.params.statementId)
        success(req, res, data)
    } catch (e) { next(e) }
})

router.post('/', createLoanValidator, async (req, res, next) => {
    try {
        const data = await ctrl.create(req.user._id, req.body)
        success(req, res, data, 201)
    } catch (e) { next(e) }
})

router.patch('/:id/pay', async (req, res, next) => {
    try {
        const data = await ctrl.pay(req.user._id, req.params.id, req.body)
        success(req, res, data)
    } catch (e) { next(e) }
})

router.patch('/:id/transfer', transferValidator, async (req, res, next) => {
    try {
        const data = await ctrl.transfer(req.user._id, req.params.id, req.body)
        success(req, res, data)
    } catch (e) { next(e) }
})

router.patch('/:id/revert-transfer', async (req, res, next) => {
    try {
        const data = await ctrl.revertTransfer(req.user._id, req.params.id)
        success(req, res, data)
    } catch (e) { next(e) }
})

router.patch('/:id/repay-savings', async (req, res, next) => {
    try {
        const data = await ctrl.repaySavings(req.user._id, req.params.id)
        success(req, res, data)
    } catch (e) { next(e) }
})

router.delete('/:id', async (req, res, next) => {
    try {
        const data = await ctrl.remove(req.user._id, req.params.id)
        success(req, res, data)
    } catch (e) { next(e) }
})

module.exports = router
