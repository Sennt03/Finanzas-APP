# Finanzas — Contexto completo de la aplicación

> Documento de referencia integral para que cualquier IA o desarrollador pueda continuar el trabajo en el repositorio con la arquitectura, las convenciones y el modelo mental correctos.
> **Última revisión a fondo del código: mayo 2026.** Incluye préstamos, compras compartidas, items pagados con tarjeta, historial de actividad y el sistema de 3 niveles de saldo.

---

## 1. ¿Qué es la app?

**Finanzas** es una aplicación web personalizada de finanzas personales construida específicamente para la forma en que el usuario (David) administra su dinero. No es una app genérica: está diseñada alrededor de un flujo mensual concreto con tarjeta de crédito, diferidos, ahorros, préstamos, sueldo fijo y categorías presupuestadas.

### Flujo mental del usuario
1. Recibe un **sueldo** cada mes.
2. Distribuye ese sueldo en **categorías** (Comida, Transporte, Ahorro, etc.) con sus **items** (sub-presupuestos). El total presupuestado **nunca puede superar el sueldo**.
3. A lo largo del mes va **marcando items como pagados** (en efectivo o con tarjeta) y registrando **gastos/ingresos extras** no presupuestados.
4. Tiene **2 cuentas**: una transaccional (Banco Pichincha) donde le llega el sueldo y se mueven los gastos del mes, y una de ahorros (Produbanco) que es **histórica** (no se reinicia mes a mes).
5. Usa **tarjeta de crédito**. Hay una fecha de **corte** (default día 12): compras antes del corte se pagan en el mes actual; compras desde el corte en adelante se pagan en el mes siguiente.
6. Algunas compras son **diferidas** a N cuotas que se reparten en N meses consecutivos.
7. Algunas compras son **compartidas**: las hizo con su tarjeta pero el monto (o parte) lo debe otra persona ("borrower"). Puede cobrar cuota por cuota o convertir una cuota impaga en un **préstamo**.
8. Puede **prestar dinero** a terceros. Los préstamos se descuentan del saldo del mes, se pueden cobrar (total o parcial), transferir a un mes futuro (cubriendo el hueco con ahorros) o devolverlos a ahorros una vez cobrados.
9. Existe un **template/plantilla** default de categorías que se aplica automáticamente al crear cada nuevo mes.
10. Cada acción relevante queda registrada en un **historial de actividad** por mes, y algunas se pueden deshacer desde ahí.

---

## 2. Stack tecnológico

### Backend (`/Backend`)
- **Node.js** + **Express 4.21**
- **MongoDB** + **Mongoose 8.8** (esquemas embebidos)
- **JWT** (`jsonwebtoken 9`) + **bcrypt** para auth
- **Joi 17** para validación (middlewares)
- **cross-env** para `NODE_ENV`, **nodemon** en dev
- Sirve el bundle compilado del Frontend desde `Backend/public/` en producción
- Variables de entorno vía `.env` (`MONGODB_URI`, `PORT`, `JWT_SECRET`, `JWT_EXPIRES_IN`)

### Frontend (`/Frontend`)
- **Angular 21** zoneless, signals, computed
- **Standalone components** (sin `standalone: true` — es el default en v20+)
- **Native control flow** (`@if`, `@for`, `@switch`) — nunca `*ngIf` / `*ngFor`
- **ChangeDetectionStrategy.OnPush** en todos los componentes
- Inputs con `FormsModule` + signals (`[ngModel]` + `(ngModelChange)`, no two-way con signals)
- **SCSS** con `@use 'sass:color'` y `@use 'vars' as *` (`src/vars.scss`)
- **Lazy loading** de feature routes
- **HttpClient interceptors**: `token.service.ts` añade JWT, `session-handler.service.ts` redirige a login en 401
- Build output: `../Backend/public` (configurado en `angular.json`)

### Path aliases (Frontend)
```
@models/      → src/app/core/models/
@services/    → src/app/core/services/
@shared/      → src/app/shared/
@material/    → src/app/shared/material/
environments/ → src/environments/
```

### Librerías UI externas
- **Bootstrap CDN** solo en las páginas auth (login/register)
- **Boxicons** (`bx bx-*`) para iconografía
- **Toastr CDN** para notificaciones (`toastr.ts` wrapper)
- **Angular Material** importado como `materialImports` (uso mínimo)

---

## 3. Estructura del repo

```
Finanzas-APP/
├── CONTEXT.md                  ← Este documento
├── README.md                   ← Resumen rápido de la app
├── mejoras.md                  ← Puntos de fuga, mejoras y features propuestas
├── Backend/
│   ├── public/                 ← Bundle Angular compilado (servido por Express)
│   └── src/
│       ├── app.js              ← Clase App: middlewares, routes, static, errors
│       ├── index.js            ← Entry: new App().start()
│       ├── config/config.js    ← env vars + whitelist CORS
│       ├── db/connection.js    ← mongoose.connect
│       ├── libs/
│       │   ├── myError.js      ← helper Error con statusCode
│       │   └── activityLog.js  ← helper log(userId, year, month, action, desc, amount, meta)
│       ├── middlewares/
│       │   ├── authHandlers.js      ← verifyToken, checkUserEmail
│       │   ├── validatorHandlers.js ← factory Joi
│       │   └── errorHandlers.js
│       ├── network/
│       │   ├── routes.js       ← Monta /api/* con todos los módulos
│       │   └── response.js     ← success/error helpers
│       └── components/         ← Cada módulo: model/controller/validators/routes
│           ├── user/
│           ├── auth/
│           ├── account/
│           ├── budgetTemplate/
│           ├── monthlyStatement/   ← el más grande (núcleo financiero)
│           ├── creditPurchase/     ← TDC, diferidos y compras compartidas
│           ├── savingsMovement/
│           ├── loan/               ← préstamos a terceros
│           └── activityLog/        ← historial por mes (con undo selectivo)
│
└── Frontend/
    ├── angular.json            ← outputPath: ../Backend/public
    └── src/
        ├── styles.scss         ← Globals + Inter font + form styles + scrollbar
        ├── vars.scss           ← Paleta + radii + shadows
        ├── environments/
        ├── index.html          ← CDNs (Bootstrap auth, Boxicons, Toastr)
        └── app/
            ├── app.routes.ts        ← /auth (noAuthGuard) | / (authGuard)
            ├── app.config.ts        ← providers (router, http, interceptors)
            ├── core/
            │   ├── models/          ← user, auth, finance.models.ts (todas las Ls*)
            │   └── services/        ← Un service por recurso (HttpClient)
            ├── shared/
            │   ├── guards/          ← auth.guard.ts, no-auth.guard.ts
            │   ├── utils/           ← toastr.ts, myValidators.ts
            │   ├── material/        ← material.imports.ts
            │   ├── components/loading/
            │   └── shared.imports.ts
            ├── auth/
            │   ├── auth.routes.ts
            │   ├── login/
            │   └── register/
            └── dashboard/
                ├── dashboard.routes.ts
                ├── dashboard.ts/html/scss   ← Sidebar + topbar móvil
                ├── home/                    ← Página inicial (dashboard)
                ├── months/
                │   ├── list/                ← Listado de meses
                │   └── detail/              ← El módulo más grande del frontend
                ├── accounts/                ← 2 cuentas + histórico de ahorros
                ├── purchases/               ← Compras TDC, diferidos y compartidas
                ├── loans/                   ← Préstamos a terceros
                └── settings/                ← Edita el budget template
```

---

## 4. Modelo de datos (MongoDB)

### `users`
```js
{ username, email (unique, lowercase), password (bcrypt) }
```

### `accounts`
```js
{
  userId, name, type: 'transactional' | 'savings',
  initialBalance: Number
}
// Index único (userId, type) → cada usuario tiene exactamente 2 cuentas
```
**Bootstrap automático**: cuando un user no tiene cuentas, se crean "Banco Pichincha" (transactional) + "Produbanco" (savings) con `initialBalance: 0`. Ocurre en `register`, en `login` y como fallback dentro de `account.list()` y `savings.create()`.

### `budgetTemplates` (uno por usuario)
```js
{
  userId (unique),
  defaultSalary: Number,
  cutoffDay: Number (default 12),
  categories: [{
    _id, name, kind: 'expense' | 'savings',
    totalAmount: Number (opcional, 0 = sin tope fijo),
    items: [{ _id, name, amount, paymentMethod?: 'cash' | 'credit' }]
  }]
}
```
> **Importante**: en el template los items tienen campo `amount`. En el statement mensual los items tienen `budgetedAmount` (porque también llevan `paidAmount`, `isPaid`, `paidAt`). Al crear un mes se mapea `amount → budgetedAmount`.

El template default crea las categorías: *Gastos fijos*, *Tarjetas de crédito*, *Familia* y *Ahorro* (esta última `kind: 'savings'`).

### `monthlyStatements`
```js
{
  userId, year, month (1-12),
  salary: Number,
  categories: [{
    _id, name, kind: 'expense' | 'savings',
    totalAmount: Number,
    items: [{
      _id, name, budgetedAmount,
      isPaid, paidAmount, paidAt,
      paymentMethod: 'cash' | 'credit'   // 'credit' = lo gobierna el toggle grupal TDC
    }]
  }],
  extras: [{ _id, name, amount, type: 'expense' | 'income', categoryName, date }],
  creditState: { tdcPaid, tdcPaidAt, diferidosPaid, diferidosPaidAt }
}
// Index único (userId, year, month)
```

### `creditPurchases` (compras TDC, diferidos y compartidas)
```js
{
  userId, name, totalAmount, purchaseDate,
  installments: Number (1 = TDC simple, >1 = diferido),
  cutoffDayUsed: Number,           // snapshot del cutoffDay al crear
  isShared: Boolean,               // la compra la debe (en parte) un tercero
  borrowerName: String,            // a quién se le prestó
  cuotas: [{
    _id, year, month, amount,
    isPaid, paidAmount, paidAt,            // pago tuyo al banco
    paidByBorrower, paidByBorrowerAt,      // lo que te ha pagado el tercero (si isShared)
    convertedToLoan: Boolean               // la cuota se volvió un préstamo independiente
  }]
}
```

### `loans` (préstamos a terceros)
```js
{
  userId, borrowerName, amount, lentDate,
  originStatementId,               // mes donde nació el préstamo
  currentStatementId,              // mes donde "pesa" ahora (puede moverse al transferir)
  status: 'pending' | 'paid' | 'transferred',
  paidAmount, paidAt,
  history: [{ type: 'lent'|'transferred'|'paid'|'partial_payment'|'repaid_savings', date, toStatementId?, savingsMovementId?, amount? }],

  // Origen del dinero / cómo se cubrió:
  fromSavings: Boolean,            // se cubrió con un retiro de ahorros (típico al transferir)
  savingsWithdrawalId,             // retiro de ahorros asociado
  paidBackToSavings: Boolean,      // ya se devolvió a ahorros tras cobrarlo
  savingsDepositId,                // depósito de devolución
  fromCard: Boolean,               // nació de una cuota compartida convertida a préstamo
  cardPurchaseId                   // creditPurchase de origen
}
// Index (userId, currentStatementId), (userId, status)
```

### `savingsMovements` (histórico de ahorros)
```js
{
  userId, accountId, type: 'deposit' | 'withdrawal',
  amount, description,
  monthlyStatementId,              // si vino de un item de tipo savings
  itemRef: { categoryId, itemId }, // para sincronización con el item
  date
}
```

### `activitylogs` (historial de actividad)
```js
{ userId, year, month, action, description, amount, metadata, createdAt }
// Index (userId, year, month, createdAt desc)
```
`metadata` guarda referencias (`statementId`, `categoryId`, `itemId`, `extraId`, `loanId`) que permiten **deshacer** ciertas acciones desde el historial.

---

## 5. Conceptos clave (críticos)

### 5.1 Categoría virtual de Tarjeta de crédito
La categoría **"Tarjeta de crédito"** NO se guarda en la BD. Se inyecta **en tiempo de lectura** dentro de `buildEnrichedStatement()` combinando:
- TDC simples (`installments === 1`) cuyas cuotas caen en el mes.
- Cuotas diferidas (`installments > 1`) que caen en el mes.
- Items "dispersos" de otras categorías marcados con `paymentMethod: 'credit'` (los `externalCreditItems`).

Tiene `_id: '__credit__'`, `isVirtual: true`, `groupKey: 'tdc'`, `kind: 'credit'`. Sus items son **read-only** y traen `purchaseId` + `cuotaId` + `subType: 'tdc' | 'diferido'` + flags de compartido (`isShared`, `borrowerName`, `paidByBorrower`, `convertedToLoan`).

El check de pago **es a nivel de categoría** (no por item): toggle único `POST /credit-group { paid }` que escribe `creditState.tdcPaid` y `diferidosPaid`. Al marcarlo, se propaga a:
- todos los items `paymentMethod: 'credit'` del statement, y
- todas las cuotas de `creditPurchases` que caen en ese mes.

### 5.2 Lógica del día de corte
En `creditPurchase/controller.js → calculateCuotas`:
```js
if (purchaseDate.getDate() >= cutoffDay) {
  month += 1   // se paga en el SIGUIENTE mes
}
// Cuotas posteriores van mes a mes consecutivamente.
// La última cuota absorbe el redondeo (total - cuota*(n-1)).
```

### 5.3 Tres niveles de saldo en la cuenta transaccional
`account.computeBalances()` **solo calcula para el mes calendario actual** (`new Date()`). Devuelve:
- **`balance`** (saldo real / en banco): descuenta solo la TDC **pagada** (`creditState.tdcPaid`) y los préstamos pendientes/transferidos.
- **`availableBalance`** (saldo disponible): descuenta **toda** la TDC del mes (propia, no la parte compartida), esté o no pagada.
- **`pendingLoansTotal`**: total de préstamos genuinamente pendientes (hint informativo).

Fórmula (idéntica en `computeBalances` y en `buildEnrichedStatement`):
```
base             = salary - paidCash - extrasExpense + extrasIncome
                 + savingsWithdrawalsDelMes
                 + paidFromSavingsNet + paidByBorrowerNet + paidFromCardNet
balance          = base - creditPaidAmt - balancePendingLoans
availableBalance = base - paidByBorrowerNet - (creditTotal - sharedShare) - balancePendingLoans
```
Donde:
- `creditTotal = tdcShare + diferidosShare + itemsShare` (items credit dispersos).
- `sharedShare` = suma de cuotas de compras compartidas en el mes (no se descuenta del disponible porque la debe un tercero).
- `paidByBorrowerNet` = lo que el tercero ya te pagó de cuotas compartidas (entra como ingreso).
- `paidFromSavingsNet` = cobros netos de préstamos cubiertos con ahorros (`collected - repaid`).
- `paidFromCardNet` = cobros de préstamos `fromCard` (la tarjeta ya cubrió el gasto).
- `balancePendingLoans` = préstamos `pending`/`transferred` que NO son `fromSavings` ni `fromCard`.

### 5.4 Categorías de ahorro (`kind: 'savings'`)
Cuando un item de una categoría `kind: 'savings'` se marca con `paidAmount > 0`, se hace un **upsert atómico** (`findOneAndUpdate` con `upsert`) de un `savingsMovement` tipo `deposit` referenciando el item (`itemRef`). Si el monto cambia se actualiza; si baja a 0 se **borran** los movimientos vinculados. Esto sincroniza el histórico de ahorros con los items marcados desde el detalle del mes.
> ⚠️ Esta sincronización solo ocurre vía `setItemAmount`. Ver §9 sobre los puntos donde NO se limpia.

### 5.5 Categorías con `totalAmount` (presupuesto fijo)
- **`totalAmount > 0`**: la categoría reserva ese monto contra el sueldo, sin importar la suma de items. Los items individuales no pueden exceder ese total combinado.
- **`totalAmount === 0`**: la categoría reserva exactamente la suma de sus items.

Helper canónico:
```js
categoryBudget(cat) = (cat.totalAmount > 0) ? cat.totalAmount : sumItems(cat)
```

### 5.6 Items pagados con tarjeta (`paymentMethod: 'credit'`)
Un item normal de cualquier categoría puede marcarse como pagado con tarjeta. Entonces:
- No se paga con el check individual (`setItemAmount` lo rechaza con error).
- Su pago lo gobierna el toggle grupal de TDC.
- Aparece dentro de la categoría virtual TDC como `externalCreditItem` y suma a `itemsShare`.

### 5.7 Compras compartidas y conversión de cuota a préstamo
Una `creditPurchase` con `isShared: true` la pagaste tú al banco, pero la debe `borrowerName`.
- `PATCH /purchases/:id/cuota/:cuotaId/pay-borrower { amount }` → registra `paidByBorrower` (lo que te devolvió).
- `PATCH /purchases/:id/cuota/:cuotaId/convert-to-loan` → marca la cuota `convertedToLoan` y crea un `loan` `fromCard` por el saldo no pagado, para seguirlo como deuda independiente.

### 5.8 Préstamos a terceros (ciclo de vida)
- **Crear** (`POST /loans`): nace `pending` en `originStatementId = currentStatementId`. Descuenta del saldo del mes.
- **Cobrar** (`PATCH /:id/pay`): total o parcial. Al completarse pasa a `paid`. Si era `fromSavings`, la respuesta avisa `needsSavingsRepayment`.
- **Transferir** (`PATCH /:id/transfer`): mueve el saldo pendiente a un mes **posterior**. Crea un retiro de ahorros (salvo `fromCard`) que cubre el hueco del mes origen, marca el original como `transferred` y crea uno nuevo `pending` (`fromSavings`) en el mes destino.
- **Devolver a ahorros** (`PATCH /:id/repay-savings`): tras cobrar un préstamo `fromSavings`, deposita el monto de vuelta en ahorros.
- **Eliminar** (`DELETE /:id`): solo si `pending` y no `fromSavings`/`fromCard`.

### 5.9 Conversión de movimientos
Cualquier movimiento (item del mes, extra, o compra TDC/diferido) puede **convertirse** a otro tipo: `POST /monthly-statements/:id/convert { source, target }`. El controller borra el origen y crea el destino preservando nombre, monto y fecha. Si el destino es TDC/diferido, se crea un `creditPurchase` que recalcula sus cuotas según el `cutoffDay` vigente.

### 5.10 Historial de actividad y undo
Cada acción relevante llama a `log(...)`. `GET /activity-logs?year&month` lista el historial del mes y marca `deletable` las acciones reversibles (`item_paid`, `item_partial`, `extra_added`, `loan_created`). `DELETE /activity-logs/:id` deshace la acción (revierte el item/extra/préstamo) y borra la entrada.

### 5.11 Borrados en cascada (manuales)
No hay hooks `pre/post remove` en Mongoose. Al borrar un statement (`DELETE /monthly-statements/:id`) se borran manualmente: `savingsMovements` del mes, `loans` (origin o current), y `activitylogs` del mes. **Cualquier nueva relación debe limpiarse manualmente.**

### 5.12 El `summary` es efímero
`monthlyStatement.summary` se construye al vuelo en cada lectura (`buildEnrichedStatement`), **nunca se persiste**. Incluye `remainingSalary`, `availableBalance`, `availableToBudget`, `pendingLoansTotal`, `savings.{monthDeposits, monthWithdrawals}` y `creditCard.{total, paid, pending, groupPaid, tdcShare, diferidosShare, itemsShare, sharedShare, ownShare}`.

---

## 6. API REST (Backend)

Todas bajo `/api`, autenticadas vía `Authorization: Bearer <token>` salvo `/auth/*`. `userId` siempre sale del token (`req.user._id`), nunca del body.

### Auth (`/api/auth`)
- `POST /register` — `{ username, email, password }` → crea user, **bootstrap accounts + template**
- `POST /login` — `{ email, password }` → `{ token, user }`, **bootstrap idempotente**
- `POST /validate/:field` — valida disponibilidad de email en registro

### User (`/api/user`)
- `GET /` — perfil del user logueado

### Accounts (`/api/accounts`)
- `GET /` — lista (con `balance`, `availableBalance`, `pendingLoansTotal` calculados al vuelo, **solo del mes actual**)
- `PATCH /:id` — `{ name?, initialBalance? }` (solo `initialBalance` aplica a savings)

### Budget Template (`/api/budget-template`)
- `GET /` — template del user (se crea con defaults si no existe)
- `PUT /` — `{ defaultSalary, cutoffDay, categories }` (valida items ≤ totalAmount y total ≤ sueldo)

### Monthly Statements (`/api/monthly-statements`)
- `GET /` — lista enriched (ordenada DESC por año/mes)
- `POST /` — `{ year, month, salary? }` (clona el template; valida que el presupuesto ≤ sueldo)
- `GET /:id` — uno enriched (con `summary`, categoría virtual TDC, etc.)
- `PUT /:id` — `{ salary?, categories? }` (preserva `paidAmount/isPaid/paidAt` por `_id`)
- `DELETE /:id` — borra el mes + cascada manual
- `POST /:id/item-amount` — `{ categoryId?, itemId, amount, purchaseId? }` (marca pago; sincroniza ahorros; `purchaseId` ⇒ paga cuota de compra)
- `POST /:id/extras` + `DELETE /:id/extras/:extraId`
- `POST /:id/credit-group` — `{ paid }` (toggle pago de toda la TDC del mes)
- `POST /:id/convert` — `{ source, target }` convierte un movimiento de tipo
- `POST /:id/categories/:categoryId/items` — agregar item inline `{ name, budgetedAmount, paymentMethod? }`
- `DELETE /:id/categories/:categoryId/items/:itemId`
- `PATCH /:id/categories/:categoryId` — `{ name?, kind?, totalAmount? }`

### Credit Purchases (`/api/purchases`)
- `GET /` — lista de compras (TDC + diferidos + compartidas)
- `POST /` — `{ name, totalAmount, purchaseDate, installments, isShared?, borrowerName? }` (calcula cuotas según cutoffDay)
- `PUT /:id` — `{ name?, totalAmount? }` (recalcula cuotas proporcionalmente preservando pagos)
- `PATCH /:id/cuota/:cuotaId/pay-borrower` — `{ amount }` (registra lo que pagó el tercero)
- `PATCH /:id/cuota/:cuotaId/convert-to-loan` — convierte la cuota impaga en préstamo `fromCard`
- `DELETE /:id`

### Loans (`/api/loans`)
- `GET /` — todos los préstamos (enriched con mes origen/actual)
- `GET /statement/:statementId` — préstamos cuyo `currentStatementId` es ese mes
- `POST /` — `{ borrowerName, amount, lentDate, statementId }`
- `PATCH /:id/pay` — `{ amount? }` (default = saldo pendiente)
- `PATCH /:id/transfer` — `{ toStatementId }` (mes posterior)
- `PATCH /:id/repay-savings` — devolver a ahorros un préstamo `fromSavings` cobrado
- `DELETE /:id` — solo `pending`, no `fromSavings`/`fromCard`

### Savings Movements (`/api/savings-movements`)
- `GET /` — histórico completo
- `POST /` — depósito/egreso manual
- `DELETE /:id` — solo si NO tiene `itemRef.itemId` (los vinculados a items se gestionan desde el detalle del mes)

### Activity Logs (`/api/activity-logs`)
- `GET /?year&month` — historial del mes (cada entrada con flag `deletable`)
- `DELETE /:id` — deshace la acción reversible y borra la entrada

---

## 7. Frontend: módulos y responsabilidades

| Si el usuario dice… | Se refiere a |
|---|---|
| "el detalle del mes" | `dashboard/months/detail/` |
| "el home" / "dashboard inicial" | `dashboard/home/` |
| "settings" / "el template" | `dashboard/settings/` (edita `budgetTemplate`) |
| "compras" / "diferidos" / "compartidas" | `dashboard/purchases/` (CRUD `creditPurchases`) |
| "préstamos" | `dashboard/loans/` (CRUD `loans`) |
| "cuentas" / "ahorros" | `dashboard/accounts/` |
| "el menú" / "sidebar" / "topbar" | `dashboard/dashboard.html/scss` |
| "el módulo de meses" | `months/list/` + `months/detail/` |
| "extras" | array `extras[]` dentro de `monthlyStatement` |
| "el corte" / "cutoff" | `budgetTemplate.cutoffDay` (default 12) |
| "la TDC" | categoría virtual TDC + `creditPurchases` |
| "saldo real" / "en banco" | `account.balance` (transactional) |
| "saldo disponible" | `account.availableBalance` |
| "items pagados" | items con `isPaid: true` o `paidAmount > 0` |
| "historial" / "actividad" | `activityLog` por mes |

**Servicios** (uno por recurso): `account`, `activity-log`, `auth`, `budget-template`, `credit-purchase`, `loan`, `monthly-statement`, `savings`, `user`, más `token` y `session-handler` (interceptors).

- **`auth/`** — Login y registro (Bootstrap CDN). `noAuthGuard` redirige a `/` si ya hay token.
- **`dashboard/`** — Layout. Sidebar fija en desktop, drawer móvil con hamburger. Avatar + logout en footer.
- **`home/`** — Switcher de mes (chips). KPIs (sueldo, presupuestado, pagado, restante, saldo disponible). Lista de últimos movimientos. Auto-selecciona el mes actual.
- **`months/list/`** — Tarjeta por mes con métricas, link a detalle. Botón "Nuevo mes".
- **`months/detail/`** — **El módulo más complejo.** Categorías (incl. virtual TDC), marcar items, editar `totalAmount` inline, agregar/eliminar items inline (con undo optimista), barra de progreso y chip "libre X", editMode (salary + categorías), extras, form transaccional para TDC/diferidos, toggle pago TDC, convertir movimientos, sección de préstamos del mes, historial de actividad.
- **`accounts/`** — Card transaccional (3 niveles de saldo), card savings (`balance` = initialBalance + Σ movimientos), tabla histórico de ahorros, form nuevo movimiento manual. Los vinculados a items no se pueden borrar aquí.
- **`purchases/`** — Secciones Diferidos / TDC simples / compartidas. Cards con total, fecha, rango de meses, cuotas pagadas/total, restante. Cobro al borrower y conversión a préstamo. Editar (recalcula cuotas). Eliminar.
- **`loans/`** — CRUD de préstamos: crear, cobrar (total/parcial), transferir a mes posterior, devolver a ahorros, eliminar.
- **`settings/`** — Edita `defaultSalary` y `cutoffDay`. CRUD categorías/items del template. Valida `totalBudgeted ≤ defaultSalary`.

---

## 8. Convenciones de código

### Backend
- Patrón **model / controller / validators / routes** por componente. Controllers exportan funciones planas (no clases).
- Errores con `myError(message, statusCode)` + `next(error)` en routes.
- Joi validators como middlewares.
- `userId` siempre del token, nunca del body.
- Mongoose subdocs: `cat.items.id(itemId)`, `subdoc.deleteOne()`, `await stmt.save()`.
- Toda acción relevante registra `await log(userId, year, month, action, desc, amount, meta)`.

### Frontend
- **Signals** para estado local (`signal`, `computed`, `.set`, `.update`; nunca `.mutate`).
- Inputs: `[ngModel]="signal()" (ngModelChange)="signal.set($event)"` (no two-way con signals).
- `@if (foo(); as f)` para narrowing. **No** arrow functions ni `new Date()` en templates.
- `CommonModule` en sharedImports (para `DecimalPipe`, `DatePipe`, `KeyValuePipe`).
- Servicios HTTP con `inject(HttpClient)` devolviendo `Observable<Ls*>`.
- **No** `*ngIf`/`*ngFor`/`*ngSwitch` (solo native control flow). **No** `ngClass`/`ngStyle` (usar `[class.x]`/`[style.x]`).
- `ChangeDetectionStrategy.OnPush` siempre. `input()`/`output()` functions, no decoradores.

### Estilos
- `@use 'sass:color'; @use 'vars' as *;` al inicio de cada `.scss`. Nunca `darken/lighten` (usar `color.adjust`).
- Paleta: texto `#0f172a` (slate-900); acento `#6366f1` (indigo); success `#10b981`; danger `#ef4444`; savings `#a855f7` (purple); credit `#f97316` (orange).
- Radii `$r-sm/md/lg/xl`. Shadows `$shadow-sm/md/lg`.

### Cosas que NO tocar salvo que David lo pida
- `app.js → staticFiles()` y `logErrors` (los edita manualmente).
- CORS whitelist en `config.js` (`localhost:4200`, `localhost:3000`, dominio Hostinger).

---

## 9. Comportamientos sutiles y riesgos a recordar

1. **`computeBalances` solo mira el mes calendario actual.** Si no existe statement del mes actual, devuelve `balance: 0`. El saldo mostrado en Cuentas ignora sobrantes/déficits de meses anteriores (diseño consciente: el saldo "reinicia" con el sueldo, pero frágil al cruzar de mes sin haber creado el statement).
2. **La sincronización de ahorros solo limpia depósitos vía `setItemAmount(0)`** (y desde el undo del historial, y al borrar el mes). **`removeItemFromCategory`, `convertMovement` y `updateMeta` NO borran el `savingsMovement` vinculado** → riesgo de depósitos huérfanos que inflan el saldo de ahorros. Ver `mejoras.md`.
3. **`updateMeta` (PUT) preserva pagos por `_id`.** Si el frontend no manda `_id` del item, se pierde `isPaid/paidAmount/paidAt`. Además puede dejar `paidAmount > budgetedAmount` (el check individual sí lo prohíbe, el PUT no).
4. **Transferir un préstamo de un mes pasado puede descuadrar:** el retiro de ahorros se crea con fecha de hoy pero la compensación en `buildEnrichedStatement` se calcula por rango de fechas del mes, mientras la deuda pesa por `currentStatementId`. Ver `mejoras.md`.
5. **Sin transacciones de Mongo:** flujos multi-documento (transfer, convert, convert-to-loan) no son atómicos; un fallo a mitad deja estado inconsistente.
6. **Build output**: `ng build` genera directamente en `Backend/public/`. En producción Express sirve esos archivos y reescribe todo lo no-`/api/*` a `index.html`.
7. **Categoría virtual TDC**: `_id: '__credit__'`, `isVirtual: true`, `groupKey: 'tdc'`. El pago va por `POST /credit-group { paid }`, nunca por `item-amount`.

---

## 10. Build y desarrollo

```bash
# Backend
cd Backend
npm install
npm run dev      # nodemon (requiere MongoDB local o MONGODB_URI en .env)
npm start        # producción

# Frontend
cd Frontend
npm install
npm start        # ng serve en :4200 (CORS configurado en backend)
npm run build    # output directo a ../Backend/public para producción
```

En producción solo se levanta el Backend; Express sirve el bundle Angular y reescribe todo lo no-`/api/*` a `index.html`.

---

## 11. Estado actual (mayo 2026)

- App funcionalmente completa para el flujo del usuario.
- Módulos vivos: meses, cuentas, compras (TDC/diferidos/compartidas), **préstamos**, ahorros, settings, **historial de actividad con undo**.
- Sistema de **3 niveles de saldo** y categoría virtual TDC unificada (incluye items `paymentMethod: 'credit'`).
- Puntos de fuga conocidos y propuestas de mejora documentados en `mejoras.md`.
