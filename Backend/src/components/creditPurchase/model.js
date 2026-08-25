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
    // Tarjeta con la que se hizo la compra (Fase 1). El corte se lee de ella.
    cardId: { type: Types.ObjectId, ref: 'cards', default: null, index: true },
    // Categoría de presupuesto que consume esta compra en su MES DE PRESUPUESTO
    // (Fase 2). Snapshot por nombre; '' = no consume ninguna categoría.
    categoryName: { type: String, default: '', trim: true },
    // Cómo se maneja una compra que se factura en un mes posterior al de compra:
    //   'retain' → RETENER: consume el presupuesto y aparta el dinero en el mes de compra
    //              (pago con el dinero de este mes); en el mes de facturación se muestra
    //              como "retenido del mes anterior".
    //   'defer'  → NO RETENER: consume el presupuesto en el mes de facturación (elijo allá
    //              de qué categoría sale); no aparta nada en el mes de compra.
    // Solo afecta compras de 1 cuota (los diferidos consumen por mes).
    budgetMode: { type: String, enum: ['retain', 'defer'], default: 'retain' },
    cuotas: { type: [cuotaSchema], default: [] },
    isShared: { type: Boolean, default: false },
    borrowerName: { type: String, default: '' }
}, {
    timestamps: true,
    versionKey: false
})

module.exports = model('creditPurchases', creditPurchaseSchema)
