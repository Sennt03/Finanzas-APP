const mongoose = require('mongoose')
const { Schema } = mongoose

const historySchema = new Schema({
    type: { type: String, enum: ['lent', 'transferred', 'paid', 'partial_payment', 'repaid_savings', 'transfer_reverted'], required: true },
    date: { type: Date, default: Date.now },
    toStatementId: Schema.Types.ObjectId,
    fromStatementId: Schema.Types.ObjectId,
    savingsMovementId: Schema.Types.ObjectId,
    transferType: { type: String, enum: ['savings', 'debt'] },
    amount: Number
}, { _id: false })

const loanSchema = new Schema({
    userId: { type: Schema.Types.ObjectId, required: true },
    borrowerName: { type: String, required: true, trim: true },
    amount: { type: Number, required: true, min: 0.01 },
    lentDate: { type: Date, required: true },
    originStatementId: { type: Schema.Types.ObjectId, required: true },
    currentStatementId: { type: Schema.Types.ObjectId, required: true },
    status: { type: String, enum: ['pending', 'paid', 'transferred'], default: 'pending' },
    paidAmount: { type: Number, default: 0, min: 0 },
    paidAt: { type: Date, default: null },
    history: [historySchema],
    fromSavings: { type: Boolean, default: false },
    savingsWithdrawalId: { type: Schema.Types.ObjectId, default: null },
    paidBackToSavings: { type: Boolean, default: false },
    savingsDepositId: { type: Schema.Types.ObjectId, default: null },
    fromCard: { type: Boolean, default: false },
    cardPurchaseId: { type: Schema.Types.ObjectId, default: null },
    // Cómo se transfirió este préstamo (origen y destino comparten el valor):
    //   'savings' → se retiró de ahorros para cubrir el mes actual (el nuevo es fromSavings).
    //   'debt'    → solo se movió la deuda al siguiente mes (el nuevo es transferDeferred).
    transferType: { type: String, enum: ['savings', 'debt'], default: null },
    transferredToLoanId: { type: Schema.Types.ObjectId, default: null },   // en el original transferido → préstamo nuevo
    transferredFromLoanId: { type: Schema.Types.ObjectId, default: null }, // en el préstamo nuevo → original
    // Préstamo RECIBIDO por transferencia de deuda: su principal ya se descontó en el mes origen.
    // NO descuenta del disponible mientras está pendiente; solo SUMA al cobrarse. Flag pegajoso
    // (se mantiene aunque luego se re-transfiera) para no duplicar el descuento en cadenas.
    transferDeferred: { type: Boolean, default: false }
}, { timestamps: true })

loanSchema.index({ userId: 1, currentStatementId: 1 })
loanSchema.index({ userId: 1, status: 1 })

module.exports = mongoose.model('Loan', loanSchema)
