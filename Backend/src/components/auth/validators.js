const Joi = require('joi')
const validatorHandler = require('../../middlewares/validatorHandlers')

const username = Joi.string().min(3)
const email = Joi.string().email()
const password = Joi.string().min(8)

const registerSchema = Joi.object({
    username: username.required(),
    email: email.required(),
    password: password.required()
})

const loginSchema = Joi.object({
    email: email.required(),
    password: password.required()
})

const validateAvaibleSchema = Joi.object({
    value: Joi.string().required()
})

const registerValidator = validatorHandler(registerSchema)
const loginValidator = validatorHandler(loginSchema)
const validateAvaibleValidator = validatorHandler(validateAvaibleSchema)

module.exports = {
    registerValidator,
    loginValidator,
    validateAvaibleValidator
}
