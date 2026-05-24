const Joi = require('joi')
const validatorHandler = require('../../middlewares/validatorHandlers')

const createLoanSchema = Joi.object({
    borrowerName: Joi.string().trim().min(1).max(100).required(),
    amount: Joi.number().positive().required(),
    lentDate: Joi.date().iso().required(),
    statementId: Joi.string().hex().length(24).required()
})

const transferSchema = Joi.object({
    toStatementId: Joi.string().hex().length(24).required(),
    mode: Joi.string().valid('savings', 'debt').required()
})

module.exports = {
    createLoanValidator: validatorHandler(createLoanSchema),
    transferValidator: validatorHandler(transferSchema)
}
