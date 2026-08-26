const { Schema, model, Types } = require('mongoose')

const savingsMovementSchema = new Schema({
    userId: {
        type: Types.ObjectId,
        ref: 'users',
        required: true,
        index: true
    },
    accountId: {
        type: Types.ObjectId,
        ref: 'accounts',
        required: true
    },
    type: {
        type: String,
        enum: ['deposit', 'withdrawal'],
        required: true
    },
    amount: { type: Number, required: true, min: 0 },
    description: { type: String, default: '', trim: true },
    monthlyStatementId: {
        type: Types.ObjectId,
        ref: 'monthlyStatements',
        default: null
    },
    itemRef: {
        categoryId: { type: Types.ObjectId },
        itemId: { type: Types.ObjectId }
    },
    // Depósito generado por un movimiento "Ahorro" del mes (se gestiona desde el mes).
    fromMonthExtra: { type: Boolean, default: false },
    date: { type: Date, default: Date.now }
}, {
    timestamps: true,
    versionKey: false
})

module.exports = model('savingsMovements', savingsMovementSchema)
