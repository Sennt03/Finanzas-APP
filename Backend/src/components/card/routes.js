const router = require('express').Router()
const controller = require('./controller')
const response = require('../../network/response')
const { verifyToken } = require('../../middlewares/authHandlers')
const { createValidator, updateValidator } = require('./validators')

router.use(verifyToken)

router.get('/', async (req, res, next) => {
    try {
        const data = await controller.list(req.user._id)
        response.success(req, res, data)
    } catch (e) { next(e) }
})

router.post('/', createValidator, async (req, res, next) => {
    try {
        const data = await controller.create(req.user._id, req.body)
        response.success(req, res, data, 201)
    } catch (e) { next(e) }
})

router.put('/:id', updateValidator, async (req, res, next) => {
    try {
        const data = await controller.update(req.user._id, req.params.id, req.body)
        response.success(req, res, data)
    } catch (e) { next(e) }
})

router.delete('/:id', async (req, res, next) => {
    try {
        const data = await controller.remove(req.user._id, req.params.id)
        response.success(req, res, data)
    } catch (e) { next(e) }
})

module.exports = router
