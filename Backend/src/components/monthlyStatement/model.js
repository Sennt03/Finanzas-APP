const { Schema, model, Types } = require('mongoose')

const itemSchema = new Schema({
    name: { type: String, required: true, trim: true },
    budgetedAmount: { type: Number, default: 0, min: 0 },
    isPaid: { type: Boolean, default: false },
    paidAmount: { type: Number, default: 0, min: 0 },
    paidAt: { type: Date, default: null },
    paymentMethod: { type: String, enum: ['cash', 'credit'], default: 'cash' }
}, { _id: true })

const categorySchema = new Schema({
    name: { type: String, required: true, trim: true },
    kind: { type: String, enum: ['expense', 'savings'], default: 'expense' },
    totalAmount: { type: Number, default: 0, min: 0 },
    items: { type: [itemSchema], default: [] }
}, { _id: true })

const extraSchema = new Schema({
    name: { type: String, required: true, trim: true },
    amount: { type: Number, default: 0, min: 0 },
    type: { type: String, enum: ['expense', 'income'], default: 'expense' },
    categoryName: { type: String, default: '' },
    date: { type: Date, default: Date.now }
}, { _id: true })

const creditStateSchema = new Schema({
    tdcPaid: { type: Boolean, default: false },
    tdcPaidAt: { type: Date, default: null },
    diferidosPaid: { type: Boolean, default: false },
    diferidosPaidAt: { type: Date, default: null }
}, { _id: false })

const monthlyStatementSchema = new Schema({
    userId: {
        type: Types.ObjectId,
        ref: 'users',
        required: true,
        index: true
    },
    year: { type: Number, required: true },
    month: { type: Number, required: true, min: 1, max: 12 },
    salary: { type: Number, default: 0, min: 0 },
    categories: { type: [categorySchema], default: [] },
    extras: { type: [extraSchema], default: [] },
    creditState: { type: creditStateSchema, default: () => ({}) }
}, {
    timestamps: true,
    versionKey: false
})

monthlyStatementSchema.index({ userId: 1, year: 1, month: 1 }, { unique: true })

module.exports = model('monthlyStatements', monthlyStatementSchema)
