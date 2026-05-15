const express = require('express')
const cors = require('cors')
const path = require('path')
const router = require('./network/routes')
const errHandler = require('./middlewares/errorHandlers')
const config = require('./config/config')
const db = require('./db/connection')

const optionsCors = {
    origin: (origin, callback) => {
        if (config.whitelist.includes(origin) || !origin) callback(null, true)
        else callback(new Error('no permitido'))
    }
}

class App {
    constructor() {
        this.app = express()
        db()
        this.middlewares()
        this.routes()
        this.staticFiles()
        this.errHandlers()
    }

    middlewares() {
        this.app.use(cors(optionsCors))
        this.app.use(express.json())
        this.app.use(express.urlencoded({ extended: true }))
    }

    routes() {
        router(this.app)
    }

    staticFiles() {
        const publicPath = path.join(__dirname, '..', 'public')
        const noCacheFiles = new Set([
            '/ngsw-worker.js',
            '/ngsw.json',
            '/safety-worker.js',
            '/worker-basic.min.js',
            '/manifest.webmanifest',
            '/index.html',
            '/'
        ])

        this.app.use((req, res, next) => {
            if (noCacheFiles.has(req.path)) {
                res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate')
                res.setHeader('Pragma', 'no-cache')
                res.setHeader('Expires', '0')
            }
            next()
        })

        this.app.use(express.static(publicPath, {
            setHeaders: (res, filePath) => {
                if (/\.[0-9a-f]{8,}\./i.test(filePath)) {
                    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
                }
            }
        }))

        this.app.get(/^(?!\/api).*/, (req, res) => {
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate')
            res.sendFile(path.join(publicPath, 'index.html'))
        })
    }

    errHandlers() {
        // this.app.use(errHandler.logErrors)
        this.app.use(errHandler.errorHandler)
    }

    start() {
        this.app.listen(config.port, () => {
            console.log(`Server on port ${config.port}`)
        })
    }
}

module.exports = App
