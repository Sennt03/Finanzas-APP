const mongoose = require('mongoose')
const config = require('../config/config')

mongoose.Promise = global.Promise

async function connect(url = config.dbUri) {
    try {
        await mongoose.connect(url)
        console.log('DB connected successfully')
    } catch (err) {
        console.error('DB connection error:', err.message)
        process.exit(1)
    }
}

module.exports = connect
