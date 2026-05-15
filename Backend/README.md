# Finanzas Backend

API REST para la app de finanzas personales.

## Stack
- Node.js (probado en v25)
- Express 4
- MongoDB + Mongoose 8
- JWT + bcrypt
- Joi (validaciones)

## Setup
```bash
cp .env.example .env
npm install
npm run dev
```

## Estructura
```
src/
  app.js                # clase App (express + middlewares + rutas + estaticos)
  index.js              # entry point
  config/config.js      # config + env
  db/
    connection.js       # mongoose connect
    store.js            # CRUD genérico por modelo
  libs/myError.js       # error con status custom
  middlewares/
    authHandlers.js     # verifyToken, checkUserEmail
    errorHandlers.js    # logErrors, errorHandler
    validatorHandlers.js # Joi validator
  network/
    routes.js           # monta /api -> /auth, /user
    response.js         # success helper
  components/
    auth/               # register, login, validate/:field
    user/               # GET /api/user (perfil)
```

## Endpoints
- `POST /api/auth/register` `{ username, email, password }`
- `POST /api/auth/login` `{ email, password }`
- `POST /api/auth/validate/:field` `{ value }` (field = email | username)
- `GET  /api/user` (Bearer token)
