const { Schema, model, Types } = require('mongoose')

const cardSchema = new Schema({
    userId: {
        type: Types.ObjectId,
        ref: 'users',
        required: true,
        index: true
    },
    name: { type: String, required: true, trim: true },
    bank: { type: String, default: '', trim: true },
    creditLimit: { type: Number, default: 0, min: 0 },   // cupo
    cutoffDay: { type: Number, default: 12, min: 1, max: 31 },   // día de corte
    paymentDay: { type: Number, default: 1, min: 1, max: 31 },   // día de pago
    color: { type: String, default: '#6366f1', trim: true },
    active: { type: Boolean, default: true },
    // Marca la tarjeta creada automáticamente por la migración / bootstrap,
    // para poder distinguirla de las que crea el usuario a mano.
    isDefault: { type: Boolean, default: false }
}, {
    timestamps: true,
    versionKey: false
})

module.exports = model('cards', cardSchema)
