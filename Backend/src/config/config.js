if (process.env.NODE_ENV !== 'production') {
    require('dotenv').config()
}

const config = {
    whitelist: ['http://localhost:4200', 'http://localhost:3000'],
    dev: process.env.NODE_ENV !== 'production',
    dbUri: process.env.MONGODB_URI || 'mongodb://localhost:27017/finanzas',
    port: process.env.PORT || 3000,
    jwtSecret: process.env.JWT_SECRET || 'change-me-please',
    jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d'
}

module.exports = config
