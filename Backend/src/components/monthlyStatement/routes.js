const router = require('express').Router()
const controller = require('./controller')
const response = require('../../network/response')
const { verifyToken } = require('../../middlewares/authHandlers')
const {
    createValidator, updateValidator,
    setItemAmountValidator,
    extraValidator,
    toggleGroupValidator,
    convertValidator,
    addItemValidator,
    updateItemCardValidator,
    updateCategoryValidator,
    compensateValidator,
    allocateValidator,
    createSavingsValidator
} = require('./validators')

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

router.get('/:id', async (req, res, next) => {
    try {
        const data = await controller.getOne(req.user._id, req.params.id)
        response.success(req, res, data)
    } catch (e) { next(e) }
})

router.put('/:id', updateValidator, async (req, res, next) => {
    try {
        const data = await controller.updateMeta(req.user._id, req.params.id, req.body)
        response.success(req, res, data)
    } catch (e) { next(e) }
})

router.delete('/:id', async (req, res, next) => {
    try {
        const data = await controller.remove(req.user._id, req.params.id)
        response.success(req, res, data)
    } catch (e) { next(e) }
})

router.post('/:id/item-amount', setItemAmountValidator, async (req, res, next) => {
    try {
        const data = await controller.setItemAmount(req.user._id, req.params.id, req.body)
        response.success(req, res, data)
    } catch (e) { next(e) }
})

router.post('/:id/extras', extraValidator, async (req, res, next) => {
    try {
        const data = await controller.addExtra(req.user._id, req.params.id, req.body)
        response.success(req, res, data, 201)
    } catch (e) { next(e) }
})

router.delete('/:id/extras/:extraId', async (req, res, next) => {
    try {
        const data = await controller.removeExtra(req.user._id, req.params.id, req.params.extraId)
        response.success(req, res, data)
    } catch (e) { next(e) }
})

router.post('/:id/savings', createSavingsValidator, async (req, res, next) => {
    try {
        const data = await controller.createSavings(req.user._id, req.params.id, req.body)
        response.success(req, res, data, 201)
    } catch (e) { next(e) }
})

router.post('/:id/credit-group', toggleGroupValidator, async (req, res, next) => {
    try {
        const data = await controller.toggleCreditGroup(req.user._id, req.params.id, req.body)
        response.success(req, res, data)
    } catch (e) { next(e) }
})

router.post('/:id/convert', convertValidator, async (req, res, next) => {
    try {
        const data = await controller.convertMovement(req.user._id, req.params.id, req.body)
        response.success(req, res, data)
    } catch (e) { next(e) }
})

router.post('/:id/categories/:categoryId/items', addItemValidator, async (req, res, next) => {
    try {
        const data = await controller.addItemToCategory(req.user._id, req.params.id, req.params.categoryId, req.body)
        response.success(req, res, data, 201)
    } catch (e) { next(e) }
})

router.delete('/:id/categories/:categoryId/items/:itemId', async (req, res, next) => {
    try {
        const data = await controller.removeItemFromCategory(req.user._id, req.params.id, req.params.categoryId, req.params.itemId)
        response.success(req, res, data)
    } catch (e) { next(e) }
})

router.patch('/:id/categories/:categoryId/items/:itemId/card', updateItemCardValidator, async (req, res, next) => {
    try {
        const data = await controller.updateItemCard(req.user._id, req.params.id, req.params.categoryId, req.params.itemId, req.body)
        response.success(req, res, data)
    } catch (e) { next(e) }
})

router.patch('/:id/categories/:categoryId', updateCategoryValidator, async (req, res, next) => {
    try {
        const data = await controller.updateCategoryMeta(req.user._id, req.params.id, req.params.categoryId, req.body)
        response.success(req, res, data)
    } catch (e) { next(e) }
})

router.post('/:id/compensate', compensateValidator, async (req, res, next) => {
    try {
        const data = await controller.compensate(req.user._id, req.params.id, req.body)
        response.success(req, res, data)
    } catch (e) { next(e) }
})

router.post('/:id/allocate', allocateValidator, async (req, res, next) => {
    try {
        const data = await controller.allocateToCategory(req.user._id, req.params.id, req.body)
        response.success(req, res, data)
    } catch (e) { next(e) }
})

router.post('/:id/close', async (req, res, next) => {
    try {
        const data = await controller.close(req.user._id, req.params.id)
        response.success(req, res, data)
    } catch (e) { next(e) }
})

router.post('/:id/reopen', async (req, res, next) => {
    try {
        const data = await controller.reopen(req.user._id, req.params.id)
        response.success(req, res, data)
    } catch (e) { next(e) }
})

module.exports = router
