const myError = require('../libs/myError')

function cleanData(data) {
    for (const key in data) {
        if (typeof data[key] === 'string') {
            data[key] = data[key].trim()
        }
    }
    return data
}

function validatorHandler(schema, property = 'body') {
    return (req, res, next) => {
        let data = req[property]
        data = cleanData(data)
        const { error } = schema.validate(data, { abortEarly: true, allowUnknown: true })
        if (error) {
            return next(myError(error, 400, error.details))
        }
        next()
    }
}

module.exports = validatorHandler
