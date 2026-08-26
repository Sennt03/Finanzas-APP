const Joi = require('joi')
const validatorHandler = require('../../middlewares/validatorHandlers')

const itemSchema = Joi.object({
    _id: Joi.any(),
    name: Joi.string().min(1).max(120).required(),
    budgetedAmount: Joi.number().min(0).default(0),
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

const createSchema = Joi.object({
    year: Joi.number().integer().min(2000).max(3000).required(),
    month: Joi.number().integer().min(1).max(12).required(),
    salary: Joi.number().min(0)
})

const updateSchema = Joi.object({
    salary: Joi.number().min(0),
    categories: Joi.array().items(categorySchema)
}).min(1)

const setItemAmountSchema = Joi.object({
    categoryId: Joi.string().allow(null, ''),
    itemId: Joi.string().required(),
    amount: Joi.number().min(0).required(),
    purchaseId: Joi.string().allow(null, '')
})

const extraSchema = Joi.object({
    name: Joi.string().min(1).max(120).required(),
    amount: Joi.number().min(0).required(),
    type: Joi.string().valid('expense', 'income').default('expense'),
    categoryName: Joi.string().allow('').default(''),
    date: Joi.date()
})

const toggleGroupSchema = Joi.object({
    group: Joi.string().valid('tdc', 'diferidos').optional(),
    paid: Joi.boolean().required()
})

const addItemSchema = Joi.object({
    name: Joi.string().min(1).max(120).required(),
    budgetedAmount: Joi.number().min(0).default(0),
    paymentMethod: Joi.string().valid('cash', 'credit').default('cash'),
    cardId: Joi.string().allow(null, ''),
    paid: Joi.boolean().default(false)
})

const updateItemCardSchema = Joi.object({
    cardId: Joi.string().allow(null, '')
})

const updateCategorySchema = Joi.object({
    name: Joi.string().min(1).max(120),
    kind: Joi.string().valid('expense', 'savings'),
    totalAmount: Joi.number().min(0),
    flexible: Joi.boolean(),
    protected: Joi.boolean()
}).min(1)

const compensateSchema = Joi.object({
    fromCategoryId: Joi.string().required(),
    toCategoryId: Joi.string().required(),
    amount: Joi.number().greater(0).required()
})

const allocateSchema = Joi.object({
    toCategoryId: Joi.string().required(),
    amount: Joi.number().greater(0).required()
})

const createSavingsSchema = Joi.object({
    amount: Joi.number().greater(0).required(),
    name: Joi.string().max(120).allow('').default(''),
    categoryId: Joi.string().allow(null, '')
})

const convertSchema = Joi.object({
    source: Joi.object({
        kind: Joi.string().valid('item', 'extra', 'purchase').required(),
        categoryId: Joi.string().allow(null, ''),
        itemId: Joi.string().allow(null, ''),
        extraId: Joi.string().allow(null, ''),
        purchaseId: Joi.string().allow(null, '')
    }).required(),
    target: Joi.object({
        type: Joi.string().valid('expense', 'income', 'tdc', 'diferido').required(),
        installments: Joi.number().integer().min(1).max(60),
        date: Joi.date(),
        categoryName: Joi.string().allow('')
    }).required()
})

module.exports = {
    createValidator: validatorHandler(createSchema),
    updateValidator: validatorHandler(updateSchema),
    setItemAmountValidator: validatorHandler(setItemAmountSchema),
    extraValidator: validatorHandler(extraSchema),
    toggleGroupValidator: validatorHandler(toggleGroupSchema),
    convertValidator: validatorHandler(convertSchema),
    addItemValidator: validatorHandler(addItemSchema),
    updateItemCardValidator: validatorHandler(updateItemCardSchema),
    updateCategoryValidator: validatorHandler(updateCategorySchema),
    compensateValidator: validatorHandler(compensateSchema),
    allocateValidator: validatorHandler(allocateSchema),
    createSavingsValidator: validatorHandler(createSavingsSchema)
}
