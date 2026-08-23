const { Schema, model, Types } = require('mongoose')

const itemSchema = new Schema({
    name: { type: String, required: true, trim: true },
    amount: { type: Number, default: 0, min: 0 },
    paymentMethod: { type: String, enum: ['cash', 'credit'], default: 'cash' }
}, { _id: true })

const categorySchema = new Schema({
    name: { type: String, required: true, trim: true },
    kind: { type: String, enum: ['expense', 'savings'], default: 'expense' },
    totalAmount: { type: Number, default: 0, min: 0 },
    flexible: { type: Boolean, default: false },
    protected: { type: Boolean, default: false },
    items: { type: [itemSchema], default: [] }
}, { _id: true })

const templateSchema = new Schema({
    userId: {
        type: Types.ObjectId,
        ref: 'users',
        required: true,
        unique: true,
        index: true
    },
    defaultSalary: { type: Number, default: 0, min: 0 },
    cutoffDay: { type: Number, default: 12, min: 1, max: 31 },
    categories: { type: [categorySchema], default: [] }
}, {
    timestamps: true,
    versionKey: false
})

module.exports = model('budgetTemplates', templateSchema)
