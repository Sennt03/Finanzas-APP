const Joi = require('joi')
const validatorHandler = require('../../middlewares/validatorHandlers')

const createSchema = Joi.object({
    name: Joi.string().min(1).max(60).required(),
    bank: Joi.string().max(60).allow('').default(''),
    creditLimit: Joi.number().min(0).default(0),
    cutoffDay: Joi.number().integer().min(1).max(31).default(12),
    paymentDay: Joi.number().integer().min(1).max(31).default(1),
    color: Joi.string().max(20).allow('').default(''),
    active: Joi.boolean().default(true)
})

const updateSchema = Joi.object({
    name: Joi.string().min(1).max(60),
    bank: Joi.string().max(60).allow(''),
    creditLimit: Joi.number().min(0),
    cutoffDay: Joi.number().integer().min(1).max(31),
    paymentDay: Joi.number().integer().min(1).max(31),
    color: Joi.string().max(20).allow(''),
    active: Joi.boolean()
}).min(1)

module.exports = {
    createValidator: validatorHandler(createSchema),
    updateValidator: validatorHandler(updateSchema)
}
