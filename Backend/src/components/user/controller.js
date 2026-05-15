const Model = require('./model')
const Store = require('../../db/store')
const store = new Store(Model)

function getUser(id) {
    return store.findOneById(id, { password: 0 })
}

module.exports = {
    getUser
}
