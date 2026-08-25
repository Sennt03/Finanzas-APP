const Joi = require('joi')
const validatorHandler = require('../../middlewares/validatorHandlers')

const createSchema = Joi.object({
    name: Joi.string().min(1).max(120).required(),
    totalAmount: Joi.number().min(0).required(),
    purchaseDate: Joi.date().required(),
    installments: Joi.number().integer().min(1).max(60).default(1),
    isShared: Joi.boolean().default(false),
    borrowerName: Joi.string().max(80).allow('').default(''),
    cardId: Joi.string().allow(null, ''),
    categoryName: Joi.string().max(120).allow('').default(''),
    budgetMode: Joi.string().valid('retain', 'defer').default('retain')
})

const updateSchema = Joi.object({
    name: Joi.string().min(1).max(120),
    totalAmount: Joi.number().min(0),
    cardId: Joi.string().allow(null, ''),
    categoryName: Joi.string().max(120).allow(''),
    budgetMode: Joi.string().valid('retain', 'defer')
}).min(1)

module.exports = {
    createValidator: validatorHandler(createSchema),
    updateValidator: validatorHandler(updateSchema)
}
