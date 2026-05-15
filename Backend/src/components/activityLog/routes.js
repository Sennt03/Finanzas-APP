const router = require('express').Router()
const { verifyToken } = require('../../middlewares/authHandlers')
const response = require('../../network/response')
const myError = require('../../libs/myError')
const ctrl = require('./controller')

router.use(verifyToken)

router.get('/', async (req, res, next) => {
    try {
        const { year, month } = req.query
        if (!year || !month) throw myError('year y month son requeridos', 400)
        const data = await ctrl.listByMonth(req.user._id, year, month)
        response.success(req, res, data)
    } catch (e) { next(e) }
})

module.exports = router
