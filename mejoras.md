# Finanzas — Puntos de fuga, mejoras y funcionalidades

> Análisis basado en una revisión a fondo del código (mayo 2026). Cada punto cita el archivo/función donde vive el problema. Ordenado por severidad.
> **Nota:** varios puntos se describen como riesgos. Antes de "arreglar" un cálculo de saldos, conviene reproducirlo con datos reales, porque algunos comportamientos son intencionales.

---

## 🔴 A. Puntos de fuga — riesgos de descuadre

Lugares donde un movimiento puede dejar los saldos o el histórico inconsistentes.

### A1. Depósitos de ahorro huérfanos al borrar / convertir / editar un item `savings`
**Severidad: alta. El más probable en uso normal.**

La sincronización ahorros↔item solo borra el `savingsMovement` vinculado dentro de `setItemAmount` cuando `amount === 0` (`monthlyStatement/controller.js:483`). Pero:

- **`removeItemFromCategory`** (`monthlyStatement/controller.js:593`) hace `item.deleteOne()` y **no** borra el `savingsMovement` con `itemRef.itemId`.
- **`convertMovement`** (rama `source.kind === 'item'`, `:249`) borra el item y tampoco limpia el depósito vinculado.
- **`updateMeta`** (PUT, `:354`) reconstruye `stmt.categories` entero; si un item `savings` desaparece del payload, su depósito queda huérfano. Tampoco reacciona si una categoría cambia de `savings` → `expense` (los depósitos previos quedan), ni crea depósitos si cambia de `expense` → `savings`.

**Efecto:** el saldo de ahorros (`account.computeBalances` para savings suma todos los `savingsMovements`) queda **inflado** por depósitos que ya no corresponden a ningún item. Además ese depósito huérfano ya no es borrable desde Cuentas (`savingsMovement.remove` bloquea los que tienen `itemRef.itemId`), así que queda atascado.

**Fix sugerido:** extraer un helper `unlinkSavingsForItem(userId, stmtId, itemId)` y llamarlo desde `removeItemFromCategory`, `convertMovement` y en `updateMeta` para cada item que desaparece o deja de ser `savings`.

---

### A2. Transferir un préstamo de un mes pasado descuadra la compensación de ahorros
**Severidad: media-alta.**

En `loan/controller.js → transfer` (`:116`) el retiro de ahorros que cubre el hueco se crea con `date: new Date()` (hoy) pero `monthlyStatementId: loan.currentStatementId` (mes origen). El préstamo original queda `transferred` y **sigue contando** en `balancePendingTotal` del mes origen (porque `['pending','transferred']` se incluyen).

La intención (ver comentario en `:50`) es que el retiro compense esa deuda y el mes origen quede neto en 0. Pero en `buildEnrichedStatement` (`:113`) los retiros se suman por **rango de fechas del mes** (`monthWithdrawals`), no por `monthlyStatementId`. Si transfieres un préstamo cuyo mes origen **no es el mes calendario actual**, el retiro (fecha de hoy) cae fuera del rango del mes origen:

- El **mes origen** pierde `remaining` sin compensación (su `availableBalance`/`balance` baja indebidamente).
- El **mes actual** gana un `+remaining` fantasma en `monthWithdrawals`.
- En `account.computeBalances` (solo mira el mes actual) el retiro de hoy infla el saldo transaccional del mes actual sin deuda que lo respalde.

**Fix sugerido:** atribuir las sumas de retiros/depósitos por `monthlyStatementId` en vez de (o además de) por fecha, al menos para los movimientos generados por préstamos. O forzar `date` del retiro al mes destino/origen correcto.

---

### A3. `availableBalance` de cuotas compartidas convertidas a préstamo: posible doble conteo
**Severidad: media (verificar con datos reales).**

Una cuota `isShared` se excluye del descuento de `availableBalance` vía `sharedShare` (asume que la debe el tercero). Si esa cuota se **convierte a préstamo** (`convertCuotaToLoan`, `creditPurchase/controller.js:116`), nace un `loan` `fromCard`. Al cobrar ese préstamo, `paidFromCardNet` suma el cobro a `base` (`monthlyStatement/controller.js:142`), **pero la cuota sigue siendo `isShared`**, así que su monto se sigue excluyendo del descuento. Resultado potencial: el `availableBalance` sube por el cobro del préstamo Y nunca se descontó la cuota → **+monto neto sin respaldo**.

**Fix sugerido:** al convertir la cuota a préstamo, dejar de tratarla como `sharedShare` (p.ej. excluir del `sharedShare` las cuotas con `convertedToLoan: true`), de modo que el flujo de deuda lo lleve solo el préstamo.

---

### A4. `paidAmount > budgetedAmount` permitido vía PUT
**Severidad: baja-media.**

`setItemAmount` prohíbe registrar más de `budgetedAmount` (`:457`), pero `updateMeta` (PUT) preserva `paidAmount` previo y permite **bajar** `budgetedAmount` por debajo de él. Queda un item con "gastado > presupuesto" e `isPaid: true`. Eso distorsiona barras de progreso y el chip "Gastado/Queda".

**Fix sugerido:** en `updateMeta`, al fijar `budgetedAmount`, clamp `paidAmount = min(paidAmount, budgetedAmount)` y recomputar `isPaid`.

---

### A5. Flujos multi-documento sin transacción
**Severidad: media (depende de fiabilidad de la BD).**

`transfer` (crea withdrawal + actualiza loan + crea loan), `convertMovement` (borra origen + crea destino), `convertCuotaToLoan` (marca cuota + crea loan) hacen varias escrituras sin `session`/transacción. Un fallo entre medias (red, validación, caída) deja estado parcial: p.ej. retiro de ahorros creado pero préstamo no transferido, o item borrado sin destino creado (se pierde el movimiento).

**Fix sugerido:** envolver estos flujos en `mongoose.startSession()` + `withTransaction` (requiere replica set; Atlas lo es por defecto). Como mínimo, reordenar para crear el destino antes de borrar el origen.

---

### A6. `convertMovement` con destino TDC/diferido ignora el item pagado
Al convertir un item ya pagado a TDC/diferido, se borra el item (su `paidAmount` desaparece del mes) y se crea una compra a crédito. Si el item se había pagado en efectivo, ese gasto cash "desaparece" y reaparece como deuda de tarjeta. Es coherente conceptualmente, pero no hay aviso ni ajuste si la cuota cae en otro mes (el corte puede mandarla al mes siguiente), dejando el mes actual con un gasto menos de lo esperado.

**Fix sugerido:** avisar en UI cuándo la cuota resultante caerá en otro mes; opcionalmente forzar `purchaseDate` para mantenerla en el mes actual.

---

### A7. Saldo de cuenta = solo mes actual
`account.computeBalances` (`account/controller.js:51`) calcula con `new Date()`. Implicaciones:

- Si aún no creaste el statement del mes actual, **Cuentas muestra `balance: 0`** aunque tengas dinero.
- El sobrante real de un mes (lo que no gastaste) no se arrastra al siguiente: el saldo "reinicia" con el sueldo. Si esto no es lo deseado, es un descuadre conceptual.

**Fix sugerido:** decidir explícitamente el modelo (¿saldo acumulado real vs. presupuesto del mes?). Si se quiere saldo bancario real, arrastrar el cierre del mes anterior como saldo inicial del siguiente.

---

## 🟠 B. Robustez y validación (backend)

### B1. Faltan validaciones de rango/coherencia
- `budgetTemplate.cutoffDay` no se valida (default 12, pero el `PUT` acepta cualquier número; un `cutoffDay > 31` o `< 1` rompe `calculateCuotas`).
- `monthlyStatement` no valida `month ∈ [1,12]` ni `year` razonable en `create` antes de tocar la BD (el índice y el schema ayudan, pero el error es feo).
- `loan.transfer` valida "mes posterior" pero no que exista el préstamo en estado correcto antes de crear el retiro (sí valida status; ok).

### B2. Race conditions en pagos concurrentes
`setItemAmount`, `pay`, `payBorrowerCuota` hacen read-modify-write sin lock. Dos requests simultáneos pueden pisarse (p.ej. cobrar dos veces el mismo préstamo si llegan a la vez). El upsert atómico de ahorros (`:486`) ya mitiga un caso; replicar el patrón (operadores atómicos `$inc` con guardas) en pagos de préstamos/cuotas.

### B3. `convert` no valida ownership del `categoryId` destino ni montos negativos del target
`convertValidator` debería revisar que `target.installments` sea coherente y que no se pueda convertir a un mes inexistente.

### B4. Borrado de mes con préstamos transferidos
`monthlyStatement.remove` (`:644`) borra loans con `currentStatementId` u `originStatementId` del mes. Pero si un préstamo fue **transferido a** este mes desde otro, borrar este mes elimina el préstamo "actual" y deja el original `transferred` apuntando a un mes destino inexistente, además del retiro de ahorros ya hecho (queda huérfano y descuadra ahorros). Revisar la cascada de transferencias.

### B5. Logs de actividad no transaccionales
`log()` (`libs/activityLog.js`) traga errores con `try/catch`. Si falla, la acción se realiza pero no queda en historial → no se podrá deshacer. Aceptable, pero documentarlo.

---

## 🟡 C. Calidad de código y arquitectura

### C1. Lógica de saldos duplicada
La fórmula de `base/realBalance/availableBalance` está **duplicada** en `monthlyStatement/controller.js:167` y `account/controller.js:141`, con riesgo de divergencia (ya hay diferencias sutiles de orden). **Extraer a un módulo único** `libs/balances.js` consumido por ambos.

### C2. `require()` dinámicos dispersos
Hay `require('../loan/model')`, `require('../creditPurchase/model')`, etc. dentro de funciones (para evitar ciclos). Funciona, pero ensucia. Considerar inyección o un index de modelos para romper los ciclos limpiamente.

### C3. Sin tests
No hay ninguna suite de tests. El núcleo financiero (corte, cuotas, balances, transferencias) es exactamente lo que más se beneficia de tests unitarios. Empezar por `calculateCuotas`, `buildEnrichedStatement` y los flujos de préstamo con fixtures.

### C4. Números en coma flotante
Todos los montos son `Number` (float). Sumas/restas repetidas acumulan error (p.ej. `0.1 + 0.2`). Para dinero, considerar trabajar en centavos (enteros) o redondear consistentemente en un único punto. `calculateCuotas` ya redondea, pero el resto no.

### C5. `Backend/public/` versionado en git
El bundle compilado está commiteado (se ve en `git status`). Genera diffs ruidosos en cada build. Considerar `.gitignore` del bundle y compilar en deploy (salvo que el hosting lo requiera commiteado).

### C6. Frontend: `months/detail` es un componente gigante
Concentra demasiadas responsabilidades. Extraer subcomponentes (categoría, item, sección TDC, sección préstamos, historial) mejoraría mantenibilidad y change detection.

---

## 🔵 D. Seguridad

- **D1.** Confirmar que `JWT_SECRET` no tiene fallback débil en `config.js` y que `JWT_EXPIRES_IN` es razonable.
- **D2.** No hay **rate limiting** en `/auth/login` ni `/register` → fuerza bruta. Añadir `express-rate-limit`.
- **D3.** No se ven **security headers** (Helmet). Añadir `helmet()`.
- **D4.** Validar tamaño del body (`express.json({ limit })`) para evitar payloads enormes.
- **D5.** El `token` se guarda en `localStorage` (XSS puede robarlo). Es aceptable para uso personal, pero documentarlo; httpOnly cookie sería más seguro.
- **D6.** Asegurar que todos los endpoints scopeen por `userId` (revisión rápida: sí lo hacen). Mantener esa disciplina en cada endpoint nuevo.

---

## 🟢 E. UX / Frontend

- **E1.** Mostrar el saldo de cuenta aunque no exista statement del mes actual (ver A7): banner "Crea el mes para ver tu saldo".
- **E2.** Avisos visuales cuando una acción puede descuadrar (convertir item pagado, transferir préstamo a futuro).
- **E3.** Estado de carga/optimismo consistente: ya hay undo optimista en items; extenderlo a extras y préstamos.
- **E4.** Accesibilidad (el CLAUDE.md del frontend exige AXE/WCAG AA): revisar contraste, foco y ARIA en modales y toggles.
- **E5.** Formateo de moneda centralizado (pipe propio `money`) en lugar de `DecimalPipe` suelto, con símbolo y separador consistentes.
- **E6.** Vista de resumen anual / comparativa entre meses (hoy todo es por mes aislado).

---

## ✨ F. Funcionalidades nuevas propuestas

Ordenadas por valor/esfuerzo aproximado.

| # | Funcionalidad | Por qué aporta |
|---|---|---|
| F1 | **Cierre de mes con arrastre de saldo** | Resuelve A7: el sobrante real pasa como saldo inicial del mes siguiente. Hace el saldo "de banco" fiel. |
| F2 | **Reportes / gráficas** (gasto por categoría, evolución de ahorros, tendencia mensual) | Visión que hoy no existe; alto valor con datos ya disponibles. |
| F3 | **Exportar a CSV/Excel/PDF** del mes y del histórico de ahorros | Respaldo y declaraciones; fácil sobre la API actual. |
| F4 | **Recordatorios / fechas de pago de TDC** | Notificar antes del corte y del pago de la tarjeta. |
| F5 | **Metas de ahorro** (objetivo, fecha, progreso) | Da propósito a la cuenta de ahorros histórica. |
| F6 | **Categorías recurrentes vs. variables / presupuesto sugerido** | Autocompletar el template según meses anteriores. |
| F7 | **Multi-moneda o ajuste por inflación** | Si maneja USD y otra moneda. |
| F8 | **Búsqueda y filtros en historial de actividad** (hoy es solo por mes) | Encontrar movimientos rápido. |
| F9 | **Adjuntar comprobantes** (foto de factura) a un gasto/compra | Útil para gastos grandes o compartidos. |
| F10 | **Resumen de "quién me debe"** (consolidado de préstamos + compras compartidas por persona) | Hoy está disperso entre `loans` y `purchases`. |
| F11 | **PWA / offline + instalable** | Ya hay `ngsw.json` en `public/` → parece haber service worker; completar la experiencia PWA. |
| F12 | **Modo oscuro** | Bajo esfuerzo con la paleta ya tokenizada en `vars.scss`. |

---

## 🧭 Prioridad sugerida (primeros pasos)

1. **A1** (depósitos de ahorro huérfanos) — bug real y frecuente, fix acotado.
2. **C1** (unificar fórmula de balances) — reduce la superficie de futuros descuadres como A2/A3.
3. **A2 / A3** (préstamos + compras compartidas) — verificar con datos reales y corregir.
4. **C3** (tests del núcleo financiero) — para que los fixes anteriores no reaparezcan.
5. **D2/D3** (rate limit + helmet) — endurecimiento rápido.
6. **F1** (cierre de mes con arrastre) — decide el modelo de saldo y cierra A7.
