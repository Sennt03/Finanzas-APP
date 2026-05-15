const Joi = require('joi')
const validatorHandler = require('../../middlewares/validatorHandlers')

const createSchema = Joi.object({
    name: Joi.string().min(1).max(120).required(),
    totalAmount: Joi.number().min(0).required(),
    purchaseDate: Joi.date().required(),
    installments: Joi.number().integer().min(1).max(60).default(1)
})

const updateSchema = Joi.object({
    name: Joi.string().min(1).max(120),
    totalAmount: Joi.number().min(0)
}).min(1)

module.exports = {
    createValidator: validatorHandler(createSchema),
    updateValidator: validatorHandler(updateSchema)
}
