const { Schema, model, Types } = require('mongoose')

const accountSchema = new Schema({
    userId: {
        type: Types.ObjectId,
        ref: 'users',
        required: true,
        index: true
    },
    name: {
        type: String,
        required: true,
        trim: true
    },
    type: {
        type: String,
        enum: ['transactional', 'savings'],
        required: true
    },
    initialBalance: {
        type: Number,
        default: 0
    }
}, {
    timestamps: true,
    versionKey: false
})

accountSchema.index({ userId: 1, type: 1 }, { unique: true })

module.exports = model('accounts', accountSchema)
