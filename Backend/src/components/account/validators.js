const Joi = require('joi')
const validatorHandler = require('../../middlewares/validatorHandlers')

const updateSchema = Joi.object({
    name: Joi.string().min(1).max(80),
    initialBalance: Joi.number().min(0)
}).min(1)

module.exports = {
    updateValidator: validatorHandler(updateSchema)
}
