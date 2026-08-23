/**
 * Migración Fases 1–4 (idempotente).
 *
 * Uso:
 *   cd Backend && node src/scripts/migrate-cards-budget.js
 *   (respeta MONGODB_URI del .env; en dev usa mongodb://localhost:27017/finanzas)
 *
 * Qué hace, por usuario:
 *   1. Crea una tarjeta por defecto (día de corte tomado del template) si no tiene ninguna.
 *   2. Asigna esa tarjeta a todas las compras de tarjeta sin `cardId`.
 *   3. Marca como `protected` las categorías de ahorro (kind: savings) en template y meses.
 *   4. Marca como `flexible` las categorías cuyo nombre coincide con las flexibles de David
 *      (Gastos Yo, Salud y piel, Compras grandes, Colchón) en template y meses.
 *
 * NO recalcula meses de facturación: ya estaban calculados con el corte al crear cada compra.
 * El mes de presupuesto se deriva en tiempo de lectura (no requiere migración de datos).
 *
 * Recomendación: respalda la base antes de correrla (mongodump).
 */
const mongoose = require('mongoose')
const config = require('../config/config')

const Card = require('../components/card/model')
const CreditPurchase = require('../components/creditPurchase/model')
const Template = require('../components/budgetTemplate/model')
const Statement = require('../components/monthlyStatement/model')
const User = require('../components/user/model')

const FLEXIBLE_NAMES = ['gastos yo', 'salud y piel', 'salud', 'compras grandes', 'colchón', 'colchon']
const PALETTE = ['#6366f1', '#f97316', '#10b981', '#a855f7', '#0ea5e9', '#ef4444', '#f59e0b']

function isFlexibleName(name) {
    const n = (name || '').trim().toLowerCase()
    return FLEXIBLE_NAMES.some(f => n === f || n.includes(f))
}

function tagCategories(categories) {
    let changed = false
    for (const cat of categories || []) {
        if (cat.kind === 'savings' && !cat.protected) { cat.protected = true; changed = true }
        if (cat.kind !== 'savings' && isFlexibleName(cat.name) && !cat.flexible) { cat.flexible = true; changed = true }
    }
    return changed
}

async function run() {
    await mongoose.connect(config.dbUri)
    console.log('Conectado a', config.dbUri)

    const users = await User.find({}, '_id username').lean()
    console.log(`Usuarios: ${users.length}`)

    let cardsCreated = 0, purchasesAssigned = 0, templatesTagged = 0, statementsTagged = 0

    for (const u of users) {
        const userId = u._id

        // 1 + 2: tarjeta por defecto y asignación de compras
        let defaultCard = await Card.findOne({ userId }).sort({ createdAt: 1 })
        const unassigned = await CreditPurchase.find({ userId, $or: [{ cardId: null }, { cardId: { $exists: false } }] })
        if (!defaultCard && (unassigned.length > 0)) {
            const tpl = await Template.findOne({ userId })
            defaultCard = await Card.create({
                userId,
                name: 'Mi tarjeta',
                bank: '',
                creditLimit: 0,
                cutoffDay: tpl?.cutoffDay || 12,
                paymentDay: 1,
                color: PALETTE[0],
                active: true,
                isDefault: true
            })
            cardsCreated++
            console.log(`  [${u.username}] tarjeta por defecto creada (corte ${defaultCard.cutoffDay})`)
        }
        if (defaultCard && unassigned.length > 0) {
            const res = await CreditPurchase.updateMany(
                { userId, $or: [{ cardId: null }, { cardId: { $exists: false } }] },
                { $set: { cardId: defaultCard._id } }
            )
            purchasesAssigned += res.modifiedCount || 0
            console.log(`  [${u.username}] ${res.modifiedCount} compras asignadas a la tarjeta por defecto`)
        }

        // 3 + 4: tags en template
        const tpl = await Template.findOne({ userId })
        if (tpl && tagCategories(tpl.categories)) {
            tpl.markModified('categories')
            await tpl.save()
            templatesTagged++
        }

        // 3 + 4: tags en cada mes
        const statements = await Statement.find({ userId })
        for (const s of statements) {
            if (tagCategories(s.categories)) {
                s.markModified('categories')
                await s.save()
                statementsTagged++
            }
        }
    }

    console.log('\n--- Resumen ---')
    console.log('Tarjetas por defecto creadas:', cardsCreated)
    console.log('Compras asignadas:', purchasesAssigned)
    console.log('Templates etiquetados:', templatesTagged)
    console.log('Meses etiquetados:', statementsTagged)

    await mongoose.disconnect()
    console.log('Listo.')
}

run().catch(err => {
    console.error('Error en migración:', err)
    process.exit(1)
})
