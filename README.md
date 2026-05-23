# 💰 Finanzas

App web de **finanzas personales** hecha a medida: organiza tu sueldo mensual en categorías, controla la tarjeta de crédito (con corte, diferidos y compras compartidas), lleva tus ahorros y registra préstamos a terceros — todo con un saldo que siempre cuadra con el banco.

> No es una app genérica: modela un flujo mensual concreto (sueldo fijo → presupuesto → pagos → cierre del mes).

---

## ✨ Qué hace

- **Meses**: cada mes parte de una plantilla de categorías e items presupuestados. Marcas pagos (en efectivo o con tarjeta), agregas gastos/ingresos extras y ves cuánto te queda.
- **Presupuesto por categoría**: tope fijo opcional por categoría, con barra de progreso y cuánto te queda libre.
- **Tarjeta de crédito**: una categoría virtual unifica compras TDC, diferidos a cuotas e items pagados con tarjeta. La fecha de **corte** decide en qué mes cae cada compra.
- **Compras compartidas**: registra compras que debe otra persona, cóbrale cuota por cuota o conviértelas en un préstamo.
- **Préstamos**: presta dinero, cóbralo (total o parcial), transfiérelo a un mes posterior (cubriéndolo con ahorros) o devuélvelo a ahorros.
- **Cuentas**: una transaccional (sueldo y gastos del mes, con saldo real / disponible) y una de ahorros histórica.
- **Historial de actividad**: cada acción del mes queda registrada y algunas se pueden deshacer.

---

## 🧱 Stack

| Capa | Tecnología |
|---|---|
| **Backend** | Node.js · Express 4 · MongoDB · Mongoose 8 · JWT · bcrypt · Joi |
| **Frontend** | Angular 21 (zoneless, signals, standalone, OnPush) · SCSS · Boxicons · Toastr |

El frontend compila a `Backend/public/` y en producción lo sirve el propio Express.

---

## 🚀 Cómo correr en local

**Requisitos:** Node.js, MongoDB (local o remoto).

### Backend
```bash
cd Backend
npm install
# crea un .env con: MONGODB_URI, PORT, JWT_SECRET, JWT_EXPIRES_IN
npm run dev        # nodemon en el puerto configurado
```

### Frontend
```bash
cd Frontend
npm install
npm start          # ng serve → http://localhost:4200
```

### Producción
```bash
cd Frontend && npm run build     # genera el bundle en ../Backend/public
cd ../Backend && npm start       # Express sirve API + frontend
```

---

## 📂 Estructura

```
Finanzas-APP/
├── Backend/      → API REST (Express + MongoDB). Sirve el frontend en prod.
├── Frontend/     → SPA Angular (dashboard, meses, cuentas, compras, préstamos, settings)
├── CONTEXT.md    → Documentación técnica completa (arquitectura, modelo de datos, API, conceptos)
├── README.md     → Este archivo
└── mejoras.md    → Puntos de fuga detectados + mejoras y features propuestas
```

---

## 📖 Más detalle

- **Arquitectura, modelo de datos, API y conceptos del dominio** → [`CONTEXT.md`](./CONTEXT.md)
- **Riesgos de descuadre, mejoras técnicas y nuevas funcionalidades** → [`mejoras.md`](./mejoras.md)

---

_Proyecto personal de David Ruiz._
