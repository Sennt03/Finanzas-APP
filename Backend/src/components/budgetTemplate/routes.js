const router = require('express').Router()
const controller = require('./controller')
const response = require('../../network/response')
const { verifyToken } = require('../../middlewares/authHandlers')
const { updateValidator } = require('./validators')

router.use(verifyToken)

router.get('/', async (req, res, next) => {
    try {
        const data = await controller.get(req.user._id)
        response.success(req, res, data)
    } catch (e) { next(e) }
})

router.put('/', updateValidator, async (req, res, next) => {
    try {
        const data = await controller.update(req.user._id, req.body)
        response.success(req, res, data)
    } catch (e) { next(e) }
})

module.exports = router
