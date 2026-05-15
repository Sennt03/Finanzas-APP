# Finanzas — Contexto completo de la aplicación

> Documento de referencia integral para que cualquier IA o desarrollador pueda continuar el trabajo en el repositorio con la arquitectura, las convenciones y el modelo mental correctos.

---

## 1. ¿Qué es la app?

**Finanzas** es una aplicación web personalizada de finanzas personales construida específicamente para la forma en que el usuario (David) administra su dinero. No es una app genérica: está diseñada alrededor de un flujo mensual concreto con tarjeta de crédito, diferidos, ahorros, sueldo fijo y categorías presupuestadas.

### Flujo mental del usuario
1. Recibe un **sueldo** cada mes.
2. Distribuye ese sueldo en **categorías** (Comida, Transporte, Ahorro, etc.) con sus **items** (sub-presupuestos). El total presupuestado **nunca puede superar el sueldo**.
3. A lo largo del mes va **marcando items como pagados** y registrando **gastos/ingresos extras** no presupuestados.
4. Tiene **2 cuentas**: una transaccional (Banco Pichincha) donde le llega el sueldo y se mueven los gastos del mes, y una de ahorros (Produbanco) que es **histórica** (no se reinicia mes a mes).
5. Usa **tarjeta de crédito**. Hay una fecha de **corte** (default día 12): compras antes del corte se pagan en el mes actual; compras desde el corte en adelante se pagan en el mes siguiente.
6. Algunas compras son **diferidas** a N cuotas que se reparten en N meses consecutivos.
7. Existe un **template/plantilla** default de categorías que se aplica automáticamente al crear cada nuevo mes.

---

## 2. Stack tecnológico

### Backend (`/Backend`)
- **Node.js v25** + **Express 4**
- **MongoDB** + **Mongoose 8** (esquemas embebidos)
- **JWT** + **bcrypt** para auth
- **Joi** para validación
- Configurado para servir el bundle compilado del Frontend desde `Backend/public/` en producción
- Variables de entorno vía `.env` (`MONGODB_URI`, `PORT`, `JWT_SECRET`, `JWT_EXPIRES_IN`)

### Frontend (`/Frontend`)
- **Angular 21** zoneless, signals, computed
- **Standalone components** (sin `standalone: true` — es el default en v20+)
- **Native control flow** (`@if`, `@for`, `@switch`) — nunca `*ngIf` / `*ngFor`
- **ChangeDetectionStrategy.OnPush** en todos los componentes
- **Reactive forms** preferidos, pero los componentes actuales usan `FormsModule` + signals (`[ngModel]` + `(ngModelChange)`) para inputs cortos
- **SCSS** con `@use 'sass:color'` y `@use 'vars' as *` (variable file en `src/vars.scss`, includePath configurado)
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
06.Finanzas/
├── Backend/
│   ├── public/                ← Bundle Angular compilado (servido por Express)
│   └── src/
│       ├── app.js             ← Clase App: middlewares, routes, static, errors
│       ├── index.js           ← Entry: new App().start()
│       ├── config/config.js   ← env vars + whitelist CORS
│       ├── db/connection.js   ← mongoose.connect
│       ├── libs/myError.js    ← helper Error con statusCode
│       ├── middlewares/
│       │   ├── authHandlers.js      ← verifyToken, checkUserEmail
│       │   ├── validatorHandlers.js ← factory Joi
│       │   └── errorHandlers.js
│       ├── network/
│       │   ├── routes.js      ← Monta /api/* con todos los módulos
│       │   └── response.js    ← success/error helpers
│       └── components/        ← Cada módulo tiene model/controller/validators/routes
│           ├── user/
│           ├── auth/
│           ├── account/
│           ├── budgetTemplate/
│           ├── monthlyStatement/
│           ├── creditPurchase/
│           └── savingsMovement/
│
└── Frontend/
    ├── angular.json           ← outputPath: ../Backend/public
    └── src/
        ├── styles.scss        ← Globals + Inter font + form styles + scrollbar
        ├── vars.scss          ← Paleta + radii + shadows
        ├── environments/
        ├── index.html         ← CDNs (Bootstrap auth, Boxicons, Toastr)
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
            │   └── shared.imports.ts ← [CommonModule, materialImports, LoadingComponent]
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
                │   └── detail/              ← El módulo más grande (estado del mes)
                ├── accounts/                ← 2 cuentas + histórico de ahorros
                ├── purchases/               ← Compras TDC y diferidos
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
  cutoffDay: Number (default 12, 1-28),
  categories: [{
    _id, name, kind: 'expense' | 'savings',
    totalAmount: Number (opcional, 0 = sin tope fijo),
    items: [{ _id, name, amount }]
  }]
}
```
> **Importante**: en el template los items tienen campo `amount`. En el statement mensual los items tienen `budgetedAmount` (porque también llevan `paidAmount` y `isPaid`). Al crear un mes se mapea `amount → budgetedAmount`.

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
      isPaid, paidAmount, paidAt
    }]
  }],
  extras: [{
    _id, name, amount,
    type: 'expense' | 'income',
    categoryName, date
  }],
  creditState: {
    tdcPaid, tdcPaidAt,
    diferidosPaid, diferidosPaidAt
  }
}
// Index único (userId, year, month)
```

### `creditPurchases` (compras TDC y diferidos)
```js
{
  userId, name, totalAmount, purchaseDate,
  installments: Number (1 = TDC simple, >1 = diferido),
  cutoffDayUsed: Number,           // snapshot del cutoffDay al crear
  cuotas: [{
    _id, year, month,
    amount, isPaid, paidAmount, paidAt
  }]
}
```

### `savingsMovements` (histórico de ahorros)
```js
{
  userId, accountId, type: 'deposit' | 'withdrawal',
  amount, description,
  monthlyStatementId,              // si vino de un item de tipo savings
  itemRef: { categoryId, itemId }, // para sincronización
  date
}
```

---

## 5. Conceptos clave (importantes)

### 5.1 Categorías virtuales (Tarjeta de crédito)
La categoría **"Tarjeta de crédito"** NO se guarda en la BD. Se inyecta **en tiempo de lectura** dentro de `buildEnrichedStatement()` combinando TDC simples + cuotas diferidas que cayeron en el mes. Sus items son **read-only** y traen `purchaseId` + `cuotaId` + `subType: 'tdc' | 'diferido'`.

El check de pago **es a nivel de categoría** (no por item): toggle único en `monthlyStatement.creditState.tdcPaid`. Al marcarlo, se propaga a todas las cuotas del mes (sus `isPaid`, `paidAmount`, `paidAt`).

### 5.2 Lógica del día de corte
Implementada en `creditPurchase/controller.js → calculateCuotas`:
```js
if (purchaseDate.getDate() >= cutoffDay) {
  // se pagará en el SIGUIENTE mes
  month += 1
}
// Cuotas posteriores van mes a mes consecutivamente
```

### 5.3 Dos saldos en la cuenta transaccional
- **`balance`** (saldo real / en banco): solo descuenta TDC **pagada** (`creditState.tdcPaid`).
- **`availableBalance`** (saldo disponible): descuenta **toda** la TDC del mes esté o no pagada.

Ambos se calculan en `account.computeBalances()`. Ojo: el saldo del banco siempre incluye TDC pendiente (lo que el banco aún no ha cobrado).

### 5.4 Categorías de ahorro (`kind: 'savings'`)
Cuando un item de una categoría `kind: 'savings'` se marca como pagado con `paidAmount > 0`, se crea automáticamente un `savingsMovement` tipo `deposit` referenciando ese item (`itemRef`). Si el monto cambia, se actualiza ese movimiento; si baja a 0, se elimina. Esto mantiene sincronizado el histórico de ahorros con los items marcados desde el detalle del mes.

### 5.5 Categorías con `totalAmount` (presupuesto fijo)
Cada categoría puede tener un `totalAmount` opcional:
- **`totalAmount > 0`**: la categoría reserva ese monto contra el sueldo, sin importar la suma de items. Los items individuales **no pueden** exceder ese total combinado.
- **`totalAmount === 0`**: la categoría reserva exactamente la suma de sus items.

El helper canónico es `categoryBudget(cat)`:
```js
function categoryBudget(cat) {
  return (cat.totalAmount > 0) ? cat.totalAmount : sumItems(cat)
}
```

### 5.6 Conversión de movimientos
Cualquier movimiento (item del template, extra, o compra TDC/diferido) puede **convertirse** a cualquier otro tipo. Endpoint: `POST /api/monthly-statements/:id/convert` con `{ source, target }`. El controller borra el origen y crea el destino preservando nombre, monto y fecha.

---

## 6. API REST (Backend)

Todas bajo `/api`, todas autenticadas vía `Authorization: Bearer <token>` salvo `/auth/*`.

### Auth (`/api/auth`)
- `POST /register` — `{ username, email, password }` → crea user, **bootstrap accounts** + template
- `POST /login` — `{ email, password }` → `{ token, user }`, **bootstrap idempotente**
- `POST /validate/:field` — para validar disponibilidad de email en registro

### User (`/api/user`)
- `GET /` — perfil del user logueado

### Accounts (`/api/accounts`)
- `GET /` — lista (con `balance` y `availableBalance` calculados al vuelo)
- `PATCH /:id` — `{ name?, initialBalance? }` (solo `initialBalance` aplica a savings)

### Budget Template (`/api/budget-template`)
- `GET /` — template del user (se crea vacío si no existe)
- `PUT /` — `{ defaultSalary, cutoffDay, categories }`

### Monthly Statements (`/api/monthly-statements`)
- `GET /` — lista enriched (ordenada DESC por fecha)
- `POST /` — `{ year, month, salary? }` (clona el template; valida sueldo)
- `GET /:id` — uno enriched (con `summary`, categoría virtual TDC, etc.)
- `PUT /:id` — `{ salary?, categories? }` (preserva `paidAmount/isPaid` por _id)
- `DELETE /:id`
- `POST /:id/item-amount` — `{ categoryId?, itemId, amount, purchaseId? }` (marca pago parcial/total; sincroniza ahorros)
- `POST /:id/extras` + `DELETE /:id/extras/:extraId`
- `POST /:id/credit-group` — `{ paid }` (toggle pago de toda la TDC del mes)
- `POST /:id/convert` — convierte un movimiento de tipo
- `POST /:id/categories/:categoryId/items` — agregar item inline
- `DELETE /:id/categories/:categoryId/items/:itemId`
- `PATCH /:id/categories/:categoryId` — `{ name?, kind?, totalAmount? }`

### Credit Purchases (`/api/purchases`)
- `GET /` — lista de compras (TDC + diferidos)
- `POST /` — `{ name, totalAmount, purchaseDate, installments }` (calcula cuotas según cutoffDay)
- `PUT /:id` — `{ name?, totalAmount? }` (recalcula cuotas proporcionalmente preservando pagos)
- `DELETE /:id`

### Savings Movements (`/api/savings-movements`)
- `GET /` — histórico completo
- `POST /` — depósito/egreso manual
- `DELETE /:id` (solo si no tiene `itemRef.itemId`; los vinculados a items se gestionan desde el detalle del mes)

---

## 7. Frontend: módulos y responsabilidades

Si el usuario dice **"el módulo X"**, se refiere a uno de estos:

### 7.1 `auth/` — Login y registro
- `auth.routes.ts` → `/auth/login`, `/auth/register`
- Páginas standalone con Bootstrap (CDN) para layout
- `noAuthGuard` redirige a `/` si ya hay token

### 7.2 `dashboard/` — Layout principal (sidebar + topbar móvil)
- Sidebar fija en desktop con gradiente, en móvil se abre desde hamburger en topbar con backdrop
- `closeSidebarOnMobile()` cierra el drawer al navegar en móvil
- Avatar + nombre + email + logout en footer del sidebar
- Logout limpia `localStorage.auth` y redirige a `/auth/login`

### 7.3 `dashboard/home/` — Inicio (dashboard)
- Switcher de mes (chips clickeables con todos los meses cargados)
- KPIs del mes seleccionado: sueldo, presupuestado, pagado, restante, saldo disponible
- Lista "Últimos movimientos" (items pagados + extras, top 8 por fecha desc)
- Auto-selecciona el mes actual al cargar (o el primero si no existe)

### 7.4 `dashboard/months/list/` — Lista de meses
- Tarjeta por mes con métricas resumidas, link a detalle
- Botón "Nuevo mes" → modal con year/month/salary opcional

### 7.5 `dashboard/months/detail/` — **EL MÓDULO MÁS COMPLEJO**
Responsabilidades:
- Mostrar todas las categorías (incluidas la virtual TDC)
- Marcar items como pagados (check + monto)
- Editar inline el `totalAmount` de cada categoría (en edit mode)
- **Agregar items inline** sin entrar a edit mode (botón "+ Agregar item" en cada categoría no-virtual)
- Eliminar items inline (botón × en cada item en read mode)
- Mostrar **barra de progreso** y chip "libre X" cuando la categoría tiene `totalAmount > 0`
- Editar el mes completo (salary + categories) con `editMode` toggle
- Agregar **extras** (gastos/ingresos no presupuestados)
- Form transaccional para agregar TDC/diferidos directamente
- Toggle de pago de la categoría TDC virtual (`toggleCreditGroup`)
- **Convertir** cualquier movimiento a otro tipo

### 7.6 `dashboard/accounts/` — Cuentas e histórico de ahorros
- Card transaccional con `balance` + `availableBalance`
- Card savings con `balance` (total = initialBalance + Σ movimientos) e `initialBalance` editable
- Tabla "Histórico de ahorros" con todos los `savingsMovements`
- Form "Nuevo movimiento" (deposit/withdrawal manual). Los movimientos vinculados a items (`itemRef.itemId`) NO se pueden eliminar desde aquí.

### 7.7 `dashboard/purchases/` — Compras TDC y diferidos
- Dos secciones separadas: **Diferidos** (installments > 1) y **TDC simples** (installments = 1)
- Cada card muestra: nombre, total, fecha, rango de meses, cuotas pagadas/total, monto restante
- Editar (nombre + total → recalcula cuotas proporcionalmente)
- Eliminar (confirm + borra todas las cuotas pagadas/pendientes)

### 7.8 `dashboard/settings/` — Configuración (Budget Template)
- Edita `defaultSalary` y `cutoffDay`
- CRUD de categorías del template (con `totalAmount` opcional)
- CRUD de items dentro de cada categoría
- Botón "Guardar" valida que `totalBudgeted ≤ defaultSalary`

---

## 8. Convenciones de código

### Backend
- Cada componente sigue el patrón **model / controller / validators / routes** (Express-style modular)
- Controllers exportan funciones planas (no clases)
- Errores con `myError(message, statusCode)` y `next(error)` en routes
- Joi validators como middlewares (`createValidator`, `updateValidator`, etc.)
- `userId` siempre viene del token (`req.user._id`), nunca del body
- Mongoose subdocs: `cat.items.id(itemId)`, `subdoc.deleteOne()`, `await stmt.save()`

### Frontend
- **Signals para estado local**: `signal()`, `computed()`, `.set()`, `.update()`. Nunca `.mutate`.
- **Inputs**: `[ngModel]="signal()" (ngModelChange)="signal.set($event)"` (no two-way `[(ngModel)]` con signals)
- **`@if (foo(); as f)`** para narrowing en templates
- **No arrow functions en templates** (no soportadas en zoneless reactivity)
- **`new Date()` no se usa en templates** — solo dentro de TS
- **CommonModule en sharedImports** es obligatorio para `DecimalPipe`, `DatePipe`, `KeyValuePipe`
- Servicios HTTP usan `inject(HttpClient)` y devuelven `Observable<Ls*>`
- **No `*ngIf` ni `*ngFor`** — siempre native control flow
- **No `ngClass` ni `ngStyle`** — usar `[class.x]` y `[style.x]`
- Componentes `ChangeDetection.OnPush` siempre
- Lifecycle: `ngOnInit()` directamente sin implementar `OnInit` (funciona en standalone)

### Estilos
- `@use 'sass:color'; @use 'vars' as *;` al inicio de cada `.scss`
- Reemplazar `darken/lighten` deprecados con `color.adjust($c, $lightness: X%)`
- Paleta:
  - **Primario / texto**: `#0f172a` (slate-900) + soft/muted/faint shades
  - **Acento**: `#6366f1` (indigo-500)
  - **Success**: `#10b981` (emerald)
  - **Danger**: `#ef4444` (red)
  - **Savings**: `#a855f7` (purple) → categoría ahorros
  - **Credit**: `#f97316` (orange) → categoría TDC
- Radii: `$r-sm: 6px`, `$r-md: 10px`, `$r-lg: 14px`, `$r-xl: 18px`
- Shadows: `$shadow-sm`, `$shadow-md`, `$shadow-lg`

---

## 9. Comportamientos sutiles a recordar

1. **Bootstrap idempotente de accounts**: ocurre en register, login y como fallback en `account.list()` y `savings.create()`. Si alguna vez aparece "Cuenta de ahorros no encontrada", el fix es asegurar el bootstrap perezoso en el endpoint que lo necesita.

2. **Templates → Statement**: al crear un mes se mapea `item.amount → item.budgetedAmount`. El campo en el template es `amount`, en el statement es `budgetedAmount`.

3. **Preservación de pagos en `updateMeta`**: el PUT del statement mapea los items entrantes con un Map indexado por `_id` para preservar `isPaid/paidAmount/paidAt`. Si el frontend no manda `_id`, se pierde el pago.

4. **Cuotas inmutables salvo total**: editar una compra solo permite cambiar nombre y monto total. Las cuotas se recalculan proporcionalmente, preservando los flags `isPaid` y ajustando `paidAmount` a la nueva cantidad.

5. **`app.js` tiene `staticFiles()` y `logErrors` configurados/comentados**: el usuario edita esto manualmente, no se deben tocar a menos que pida lo contrario explícitamente.

6. **Build output**: `ng build` genera directamente en `Backend/public/`. En producción, Express sirve estos archivos y los rewrites a SPA están en `app.js → staticFiles()`.

7. **CORS whitelist** en `config.js` incluye `localhost:4200`, `localhost:3000` y el dominio de Hostinger desplegado.

8. **Categoría virtual TDC**: tiene `_id: '__credit__'`, `isVirtual: true`, `groupKey: 'tdc'`. El check de pago se manda con `POST /credit-group { paid: bool }`, NO con `item-amount`.

9. **Conversiones**: si conviertes un item del mes a TDC/diferido, se borra el item y se crea un `creditPurchase` que automáticamente recalcula sus cuotas según el cutoffDay vigente.

10. **`monthlyStatement.summary`** se construye al vuelo en cada lectura, nunca se persiste. Incluye `availableBalance` (con TDC descontada completa), `remainingSalary` (saldo real con solo TDC pagada descontada), `creditCard.{ total, paid, pending, groupPaid, tdcShare, diferidosShare }`.

---

## 10. Cómo referirse a las cosas

Cuando el usuario diga algo como:

| Frase | Se refiere a |
|---|---|
| "el detalle del mes" | `Frontend/src/app/dashboard/months/detail/` |
| "el home" o "el dashboard inicial" | `Frontend/src/app/dashboard/home/` |
| "settings" o "el template" | `Frontend/src/app/dashboard/settings/` (edita `budgetTemplate`) |
| "compras" o "diferidos" | `Frontend/src/app/dashboard/purchases/` (CRUD de `creditPurchases`) |
| "cuentas" o "ahorros" | `Frontend/src/app/dashboard/accounts/` |
| "el menú", "sidebar" o "topbar" | `Frontend/src/app/dashboard/dashboard.html/scss` |
| "el módulo de meses" | tanto `months/list/` como `months/detail/` |
| "extras" | el array `extras[]` dentro de `monthlyStatement` |
| "el corte" o "cutoff" | `budgetTemplate.cutoffDay` (default 12) |
| "la TDC" | la categoría virtual TDC + los `creditPurchases` |
| "saldo real" / "en banco" | `account.balance` (transactional) |
| "saldo disponible" | `account.availableBalance` (descuenta TDC completa) |
| "items pagados" | items con `isPaid: true` o `paidAmount > 0` |

---

## 11. Build y desarrollo

```bash
# Backend
cd Backend
npm install
npm run dev      # nodemon
# Requiere MongoDB local o MONGODB_URI en .env

# Frontend
cd Frontend
npm install
npm start        # ng serve en :4200 con proxy implícito vía CORS
# o
npm run build    # output directo a ../Backend/public para producción
```

En producción solo se levanta el Backend; Express sirve el bundle Angular y rewrites todo lo no-`/api/*` a `index.html`.

---

## 12. Estado actual (mayo 2026)

- App funcionalmente completa para el flujo del usuario.
- Última feature añadida: **`totalAmount` opcional por categoría** + **agregar/eliminar items inline desde el detalle del mes** + barra de progreso y chip "libre X" indicando presupuesto restante.
- Build limpio en última compilación.
- Pendiente: el usuario probará flujo end-to-end con categorías que tengan `totalAmount` y dará feedback.
