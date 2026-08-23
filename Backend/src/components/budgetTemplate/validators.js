const Joi = require('joi')
const validatorHandler = require('../../middlewares/validatorHandlers')

const itemSchema = Joi.object({
    _id: Joi.any(),
    name: Joi.string().min(1).max(120).required(),
    amount: Joi.number().min(0).default(0),
    paymentMethod: Joi.string().valid('cash', 'credit').default('cash')
})

const categorySchema = Joi.object({
    _id: Joi.any(),
    name: Joi.string().min(1).max(120).required(),
    kind: Joi.string().valid('expense', 'savings').default('expense'),
    totalAmount: Joi.number().min(0).default(0),
    flexible: Joi.boolean().default(false),
    protected: Joi.boolean().default(false),
    items: Joi.array().items(itemSchema).default([])
})

const updateSchema = Joi.object({
    defaultSalary: Joi.number().min(0),
    cutoffDay: Joi.number().integer().min(1).max(31),
    categories: Joi.array().items(categorySchema)
}).min(1)

module.exports = {
    updateValidator: validatorHandler(updateSchema)
}
