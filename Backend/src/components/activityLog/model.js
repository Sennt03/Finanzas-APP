const { Schema, model } = require('mongoose')

const schema = new Schema({
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    year: { type: Number, required: true },
    month: { type: Number, required: true },
    action: { type: String, required: true },
    description: { type: String, required: true },
    amount: { type: Number, default: null },
    metadata: { type: Schema.Types.Mixed, default: {} }
}, { timestamps: true })

schema.index({ userId: 1, year: 1, month: 1, createdAt: -1 })

module.exports = model('ActivityLog', schema)
