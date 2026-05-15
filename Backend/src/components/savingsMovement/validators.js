const Joi = require('joi')
const validatorHandler = require('../../middlewares/validatorHandlers')

const createSchema = Joi.object({
    type: Joi.string().valid('deposit', 'withdrawal').required(),
    amount: Joi.number().min(0).required(),
    description: Joi.string().allow('').max(200),
    monthlyStatementId: Joi.string().allow(null, ''),
    date: Joi.date()
})

module.exports = {
    createValidator: validatorHandler(createSchema)
}
