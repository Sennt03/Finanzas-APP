const config = require('../config/config')

function withErrorStack(error, stack) {
    if (config.dev) {
        return { message: error, stack }
    }

    return { message: error, stack }
}

function logErrors(err, req, res, next) {
    if (config.dev) console.error(err)
    next(err)
}

function errorHandler(err, req, res, next) {
    const messageError = err.own ? err.message : 'Internal server error'
    const statusCode = err.own ? err.status : 500
    res.status(statusCode).json(withErrorStack(messageError, err.stack))
}

module.exports = {
    logErrors,
    errorHandler
}
