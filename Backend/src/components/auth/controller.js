const bcrypt = require('bcrypt')
const jwt = require('jsonwebtoken')
const myError = require('../../libs/myError')
const config = require('../../config/config')
const Model = require('../user/model')
const Store = require('../../db/store')
const accountController = require('../account/controller')
const templateController = require('../budgetTemplate/controller')
const store = new Store(Model)

async function register(user) {
    const password = await bcrypt.hash(user.password, 10)
    user.password = password
    const newUser = await store.addOne(user)

    await Promise.all([
        accountController.bootstrap(newUser._id),
        templateController.bootstrap(newUser._id)
    ])

    const sendUser = createSendUser(newUser)
    const token = jwt.sign(sendUser, config.jwtSecret, { expiresIn: config.jwtExpiresIn })

    return { user: sendUser, token }
}

async function login({ email, password }) {
    const user = await store.findOne({ email })

    if (!user) {
        throw myError('Unauthorized', 401)
    }

    const isMatch = await bcrypt.compare(password, user.password)
    if (!isMatch) {
        throw myError('Unauthorized', 401)
    }

    await Promise.all([
        accountController.bootstrap(user._id),
        templateController.bootstrap(user._id)
    ])

    const sendUser = createSendUser(user)
    const token = jwt.sign(sendUser, config.jwtSecret, { expiresIn: config.jwtExpiresIn })

    return { user: sendUser, token }
}

async function validateAvaible({ field, value }) {
    if (!['email', 'username'].includes(field)) {
        throw myError('Invalid field', 400)
    }
    const exists = await store.findOne({ [field]: value })
    return { isAvailable: !exists }
}

function createSendUser(user) {
    return {
        _id: user._id,
        username: user.username,
        email: user.email
    }
}

module.exports = {
    register,
    login,
    validateAvaible
}
