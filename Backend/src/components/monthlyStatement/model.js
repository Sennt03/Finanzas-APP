const { Schema, model, Types } = require('mongoose')

const itemSchema = new Schema({
    name: { type: String, required: true, trim: true },
    budgetedAmount: { type: Number, default: 0, min: 0 },
    isPaid: { type: Boolean, default: false },
    paidAmount: { type: Number, default: 0, min: 0 },
    paidAt: { type: Date, default: null },
    paymentMethod: { type: String, enum: ['cash', 'credit'], default: 'cash' },
    // Tarjeta con la que se paga (solo aplica si paymentMethod === 'credit').
    cardId: { type: Types.ObjectId, ref: 'cards', default: null }
}, { _id: true })

const categorySchema = new Schema({
    name: { type: String, required: true, trim: true },
    kind: { type: String, enum: ['expense', 'savings'], default: 'expense' },
    totalAmount: { type: Number, default: 0, min: 0 },
    // Fase 3: categorías "flexibles" (Gastos Yo, Salud, Compras grandes, Colchón)
    // cuyo restante suma al número "PUEDO GASTAR".
    flexible: { type: Boolean, default: false },
    // Fase 4: categoría protegida (ahorro): retiros requieren confirmación + motivo.
    protected: { type: Boolean, default: false },
    items: { type: [itemSchema], default: [] }
}, { _id: true })

const extraSchema = new Schema({
    name: { type: String, required: true, trim: true },
    amount: { type: Number, default: 0, min: 0 },
    type: { type: String, enum: ['expense', 'income'], default: 'expense' },
    categoryName: { type: String, default: '' },
    // Si el ingreso proviene de un egreso de ahorros (retiro a transaccional),
    // queda vinculado a ese movimiento para mantenerlos sincronizados al borrar.
    linkedSavingsId: { type: Types.ObjectId, ref: 'savingsMovements', default: null },
    // Si este movimiento (gasto) es en realidad un AHORRO enviado a la cuenta de
    // ahorros, queda vinculado al depósito que lo generó.
    savingsDepositId: { type: Types.ObjectId, ref: 'savingsMovements', default: null },
    date: { type: Date, default: Date.now }
}, { _id: true })

const creditStateSchema = new Schema({
    tdcPaid: { type: Boolean, default: false },
    tdcPaidAt: { type: Date, default: null },
    diferidosPaid: { type: Boolean, default: false },
    diferidosPaidAt: { type: Date, default: null }
}, { _id: false })

// Fase 4: snapshot del cierre de mes. Ancla el saldo de ahorros para que el
// saldo final de un mes sea exactamente el inicial del siguiente.
const overspentSchema = new Schema({
    name: String,
    budget: Number,
    spent: Number,
    over: Number
}, { _id: false })

const closingSchema = new Schema({
    closedAt: { type: Date, default: null },
    savingsStart: { type: Number, default: 0 },
    savingsEnd: { type: Number, default: 0 },
    netSavings: { type: Number, default: 0 },
    apartadoCarried: { type: Number, default: 0 },
    overspent: { type: [overspentSchema], default: [] }
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
    creditState: { type: creditStateSchema, default: () => ({}) },
    closing: { type: closingSchema, default: null }
}, {
    timestamps: true,
    versionKey: false
})

monthlyStatementSchema.index({ userId: 1, year: 1, month: 1 }, { unique: true })

module.exports = model('monthlyStatements', monthlyStatementSchema)
