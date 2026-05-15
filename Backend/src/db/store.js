class Store {
    constructor(model) {
        this.Model = model
    }

    addOne(data) {
        const newModel = new this.Model(data)
        return newModel.save()
    }

    findOneById(id, options = {}) {
        return this.Model.findById(id, options)
    }

    findAll(query = {}, options = {}) {
        return this.Model.find(query, options)
    }

    findOne(query = {}, options = {}) {
        return this.Model.findOne(query, options)
    }

    updateOne(id, data) {
        return this.Model.findByIdAndUpdate(id, data, { new: true })
    }

    deleteOne(id) {
        return this.Model.findByIdAndDelete(id)
    }

    query(query, dataQuery = {}, options = {}) {
        return this.Model[query](dataQuery, options)
    }
}

module.exports = Store
