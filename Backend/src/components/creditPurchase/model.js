const { Schema, model, Types } = require('mongoose')

const cuotaSchema = new Schema({
    year: { type: Number, required: true },
    month: { type: Number, required: true, min: 1, max: 12 },
    amount: { type: Number, required: true, min: 0 },
    isPaid: { type: Boolean, default: false },
    paidAmount: { type: Number, default: 0, min: 0 },
    paidAt: { type: Date, default: null },
    paidByBorrower: { type: Number, default: 0, min: 0 },
    paidByBorrowerAt: { type: Date, default: null },
    convertedToLoan: { type: Boolean, default: false }
}, { _id: true })

const creditPurchaseSchema = new Schema({
    userId: {
        type: Types.ObjectId,
        ref: 'users',
        required: true,
        index: true
    },
    name: { type: String, required: true, trim: true },
    totalAmount: { type: Number, required: true, min: 0 },
    purchaseDate: { type: Date, required: true },
    installments: { type: Number, default: 1, min: 1 },
    cutoffDayUsed: { type: Number, required: true },
    cuotas: { type: [cuotaSchema], default: [] },
    isShared: { type: Boolean, default: false },
    borrowerName: { type: String, default: '' }
}, {
    timestamps: true,
    versionKey: false
})

module.exports = model('creditPurchases', creditPurchaseSchema)
