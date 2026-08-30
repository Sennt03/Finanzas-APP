import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { MonthlyStatementService } from '@services/monthly-statement.service';
import { CreditPurchaseService } from '@services/credit-purchase.service';
import { LoanService } from '@services/loan.service';
import { AccountService } from '@services/account.service';
import { CardService } from '@services/card.service';
import {
  CategoryKind, ExtraType, LsCard, LsCardBreakdown, LsLoan, LsMonthlyStatement, LsStatementCategory, LsStatementExtra, LsStatementItem, MONTH_NAMES
} from '@models/finance.models';
import { sharedImports } from '@shared/shared.imports';
import toastr from '@shared/utils/toastr';

const LAST_CARD_KEY = 'lastCardId';

type CompPending =
  | { kind: 'add'; cat: LsStatementCategory; name: string; amount: number; paymentMethod: 'cash' | 'credit'; cardId: string | null; paid: boolean }
  | { kind: 'purchase'; payload: any; typeLabel: string; statementId: string };

interface DraftItem {
  _id?: string;
  name: string;
  budgetedAmount: number;
  paymentMethod: 'cash' | 'credit';
}
interface DraftCategory {
  _id?: string;
  name: string;
  kind: CategoryKind;
  totalAmount: number;
  items: DraftItem[];
}

type TxType = 'expense' | 'income' | 'tdc' | 'diferido' | 'ahorro';

@Component({
  selector: 'app-month-detail',
  imports: [...sharedImports, FormsModule, RouterModule],
  templateUrl: './month-detail.component.html',
  styleUrl: './month-detail.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class MonthDetailComponent {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private svc = inject(MonthlyStatementService);
  private purchaseSvc = inject(CreditPurchaseService);
  private loanSvc = inject(LoanService);
  private accountSvc = inject(AccountService);
  private cardSvc = inject(CardService);

  cards = signal<LsCard[]>([]);
  stmt = signal<LsMonthlyStatement | null>(null);
  // Saldo real de la cuenta de ahorros (histórico, no asumido)
  savingsBalance = signal<number | null>(null);
  loading = signal(false);
  editMode = signal(false);

  draftSalary = signal(0);
  draftCategories = signal<DraftCategory[]>([]);

  // Transaction form
  showTx = signal(false);
  flashExtras = signal(false); // resalta la sección al saltar con el botón rápido

  // Navegador de secciones (FAB que despliega accesos rápidos dentro del mes)
  showNav = signal(false);
  txType = signal<TxType>('expense');
  txName = signal('');
  txAmount = signal<number | null>(null);
  txCategoryName = signal('');
  txSavingsSource = signal<string>(''); // '' = bote sin categoría; si no, un categoryId
  txDate = signal(this.todayIso());
  txInstallments = signal(2);
  txIsShared = signal(false);
  txBorrowerName = signal('');
  txCardId = signal<string | null>(null);
  txPurchaseCategory = signal('');
  txBudgetMode = signal<'retain' | 'defer'>('retain');

  // Compensación de sobregiro (Fase 4)
  compTarget = signal<LsStatementCategory | null>(null);
  compOverflow = signal(0);
  compSourceId = signal<string | null>(null);
  private compPending: CompPending | null = null;

  // Cierre de mes (Fase 4)
  showClose = signal(false);

  // Detalle de saldos plegable
  showSaldos = signal(true);
  toggleSaldos() { this.showSaldos.update(v => !v); }

  // Presupuestar a una categoría desde el sueldo no presupuestado ('salary') o de los
  // ingresos extra sobrantes ('extra'). Son dos orígenes separados.
  allocating = signal(false);
  allocSource = signal<'salary' | 'extra'>('salary');
  allocCatId = signal<string>('__new__');
  allocNewName = signal('');
  allocAmount = signal<number>(0);
  // Para 'salary': categorías normales. Para 'extra': categorías de ingreso extra.
  allocCats = computed(() => {
    const extra = this.allocSource() === 'extra';
    return (this.stmt()?.categories ?? [])
      .filter(c => !c.isVirtual && c.kind !== 'savings' && !!c.fromExtraIncome === extra);
  });

  openAllocate(source: 'salary' | 'extra') {
    this.allocSource.set(source);
    const cats = this.allocCats();
    this.allocCatId.set(cats[0]?._id ?? '__new__');
    this.allocNewName.set('');
    const sc = this.stmt()?.summary.sinCategoria;
    this.allocAmount.set((source === 'extra' ? sc?.extraAvailable : sc?.salaryAvailable) ?? 0);
    this.allocating.set(true);
  }
  closeAllocate() { this.allocating.set(false); }

  submitAllocate() {
    const s = this.stmt();
    const sel = this.allocCatId();
    const amt = Number(this.allocAmount());
    if (!s || amt <= 0) { toastr.error('Indica un monto válido', ''); return; }
    const payload: { toCategoryId?: string; newCategoryName?: string; amount: number; source: 'salary' | 'extra' } = { amount: amt, source: this.allocSource() };
    if (sel === '__new__') {
      const name = this.allocNewName().trim();
      if (!name) { toastr.error('Escribe el nombre de la categoría', ''); return; }
      payload.newCategoryName = name;
    } else {
      payload.toCategoryId = sel;
    }
    this.loading.set(true);
    this.svc.allocate(s._id, payload).subscribe({
      next: (updated) => { this.stmt.set(updated); this.loading.set(false); this.allocating.set(false); toastr.success('Presupuestado a la categoría', ''); },
      error: (err) => { this.loading.set(false); toastr.error(err.error?.message ?? 'Error', ''); }
    });
  }

  itemDrafts = signal<Record<string, number | null>>({});
  itemSaving = signal<Record<string, boolean>>({});

  // Estado "Agregar item" inline por categoría
  addingForCategory = signal<string | null>(null);
  newItemName = signal('');
  newItemAmount = signal<number | null>(null);
  newItemPaymentMethod = signal<'cash' | 'credit'>('cash');
  newItemCardId = signal<string | null>(null);

  // Préstamos del mes
  monthLoans = signal<LsLoan[]>([]);
  showLoanForm = signal(false);
  loanBorrower = signal('');
  loanAmount = signal<number | null>(null);
  loanDate = signal(this.todayIso());

  // Pago parcial de préstamos
  payingLoanId = signal<string | null>(null);
  loanPayAmount = signal<number | null>(null);

  // Pago de cuotas compartidas (cobrar a quien prestó la tarjeta)
  payingBorrowerCuotaId = signal<string | null>(null);
  borrowerPayAmount = signal<number | null>(null);

  // Eliminación optimista con undo: solo un item pendiente a la vez
  pendingDelete = signal<{
    statementId: string;
    categoryId: string;
    itemId: string;
    name: string;
    timer: any;
    deadline: number;
  } | null>(null);

  private readonly UNDO_DELAY_MS = 5000;

  // ----- Exportar mes -----
  showExport = signal(false);
  exportFormat = signal<'mine' | 'structured'>('mine');

  exportText = computed(() => {
    const s = this.stmt();
    if (!s) return '';
    return this.exportFormat() === 'mine'
      ? this.buildMineFormat(s, this.monthLoans())
      : this.buildStructuredFormat(s, this.monthLoans());
  });

  monthLabel = computed(() => {
    const s = this.stmt();
    return s ? `${MONTH_NAMES[s.month - 1]} ${s.year}` : '';
  });

  // ¿El mes tiene categoría virtual de tarjeta? (controla el acceso "Tarjeta" del navegador)
  hasCredit = computed(() => (this.stmt()?.categories || []).some(c => c.isVirtual));

  // Movimientos extras agrupados por día, de más reciente a más viejo.
  // Cada grupo expone el total gastado (expense) e ingresado (income) de ese día.
  extrasByDay = computed(() => {
    const s = this.stmt();
    if (!s) return [] as { key: string; label: string; spent: number; income: number; items: LsStatementExtra[] }[];
    const groups = new Map<string, { key: string; label: string; sortKey: number; spent: number; income: number; items: LsStatementExtra[] }>();
    for (const e of s.extras) {
      const d = new Date(e.date);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      let g = groups.get(key);
      if (!g) {
        g = { key, label: this.dayLabel(d), sortKey: d.getTime(), spent: 0, income: 0, items: [] };
        groups.set(key, g);
      }
      g.items.push(e);
      if (e.type === 'income') g.income += e.amount; else g.spent += e.amount;
    }
    const arr = [...groups.values()].sort((a, b) => b.sortKey - a.sortKey);
    for (const g of arr) g.items.reverse(); // dentro del día, lo último agregado arriba
    return arr;
  });

  /** Etiqueta amistosa para el separador de día: "Hoy", "Ayer" o "Vie 23 may". */
  private dayLabel(d: Date): string {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const day = new Date(d); day.setHours(0, 0, 0, 0);
    const diff = Math.round((today.getTime() - day.getTime()) / 86400000);
    if (diff === 0) return 'Hoy';
    if (diff === 1) return 'Ayer';
    const txt = new Intl.DateTimeFormat('es', { weekday: 'short', day: 'numeric', month: 'short' })
      .format(d)
      .replace(/\./g, '')
      .replace(',', '');
    return txt.charAt(0).toUpperCase() + txt.slice(1);
  }

  draftTotalBudgeted = computed(() =>
    this.draftCategories().reduce((acc, c) => {
      const sum = c.items.reduce((a, i) => a + (Number(i.budgetedAmount) || 0), 0);
      const budget = (c.totalAmount && c.totalAmount > 0) ? Number(c.totalAmount) : sum;
      return acc + budget;
    }, 0)
  );

  draftRemaining = computed(() => this.draftSalary() - this.draftTotalBudgeted());

  ngOnInit() {
    const id = this.route.snapshot.paramMap.get('id');
    if (id) this.load(id);
    this.refreshSavings();
    this.cardSvc.list().subscribe({ next: (c) => this.cards.set(c), error: () => {} });
  }

  activeCards = computed(() => this.cards().filter(c => c.active));
  cardMap = computed(() => new Map(this.cards().map(c => [c._id, c])));

  // Fase corte: la compra cruza el corte (día compra >= día corte de la tarjeta) → se factura
  // el mes siguiente y ahí sí tiene sentido elegir retener/no retener. Si es antes del corte,
  // se paga este mismo mes y se fuerza "retener" (descuenta este mes), sin mostrar la opción.
  txCrossesCutoff = computed(() => {
    const day = new Date(this.txDate() + 'T00:00:00').getDate();
    const card = this.txCardId() ? this.cardMap().get(this.txCardId()!) : null;
    const cutoff = card?.cutoffDay ?? 12;
    return day >= cutoff;
  });

  // "Presupuestado" solo se muestra si NO coincide con el sueldo (si coincide es redundante).
  budgetedDiffersFromSalary(s: LsMonthlyStatement): boolean {
    return Math.abs((s.summary?.totalBudgeted ?? 0) - (s.salary ?? 0)) > 0.005;
  }

  cardName(id?: string | null): string {
    if (!id) return 'Sin tarjeta';
    return this.cardMap().get(id)?.name ?? 'Sin tarjeta';
  }
  cardColor(id?: string | null): string {
    if (!id) return '#94a3b8';
    return this.cardMap().get(id)?.color ?? '#94a3b8';
  }
  monthName(m?: number): string {
    return m ? MONTH_NAMES[m - 1] : '';
  }

  // Categorías reales (no virtuales) para el selector de categoría en compras de tarjeta.
  realCategoryNames = computed(() => (this.stmt()?.categories ?? []).filter(c => !c.isVirtual).map(c => c.name));

  // Categorías desde las que puede salir un ahorro (categorías de gasto, con su restante).
  savableCats = computed(() => (this.stmt()?.categories ?? [])
    .filter(c => !c.isVirtual && c.kind !== 'savings')
    .map(c => ({ id: c._id!, name: c.name, remaining: this.categoryRemainingToPay(c) })));

  isClosed = computed(() => !!this.stmt()?.closing?.closedAt);

  // Si el presupuesto (categorías + avance) pasa el sueldo: sugerir recortar de abajo hacia arriba.
  budgetCutOrder = computed(() => {
    const s = this.stmt();
    if (!s || s.summary.presupuestoExcedido <= 0) return [] as { name: string; budget: number }[];
    return [...s.categories]
      .filter(c => !c.isVirtual && c.kind !== 'savings' && (c.categoryBudget ?? c.totalAmount ?? 0) > 0)
      .reverse()
      .map(c => ({ name: c.name, budget: c.categoryBudget ?? c.totalAmount ?? 0 }));
  });

  // Menú de opciones (⋮) por cuota de tarjeta: cambiar categoría, tarjeta o convertir.
  cuotaMenu = signal<string | null>(null);
  toggleCuotaMenu(key: string) { this.cuotaMenu.update(v => v === key ? null : key); }
  closeCuotaMenu() { this.cuotaMenu.set(null); }
  isCuotaMenuOpen(key?: string | null): boolean { return !!key && this.cuotaMenu() === key; }

  // Reasignar la categoría / tarjeta de una compra de tarjeta ya creada.
  reassignCategory(purchaseId: string, categoryName: string) {
    const s = this.stmt();
    if (!s) return;
    this.closeCuotaMenu();
    this.loading.set(true);
    this.purchaseSvc.update(purchaseId, { categoryName }).subscribe({
      next: () => { this.load(s._id); toastr.success(categoryName ? 'Categoría asignada' : 'Categoría quitada', ''); },
      error: (err) => { this.loading.set(false); toastr.error(err.error?.message ?? 'Error', ''); }
    });
  }

  reassignCard(purchaseId: string, cardId: string) {
    const s = this.stmt();
    if (!s) return;
    this.closeCuotaMenu();
    this.loading.set(true);
    this.purchaseSvc.update(purchaseId, { cardId }).subscribe({
      next: () => { this.load(s._id); toastr.success('Tarjeta cambiada', ''); },
      error: (err) => { this.loading.set(false); toastr.error(err.error?.message ?? 'Error', ''); }
    });
  }

  // Cambiar la tarjeta de un item pagado con tarjeta (paymentMethod: 'credit').
  setItemCard(categoryId: string | undefined, itemId: string | undefined, cardId: string) {
    const s = this.stmt();
    if (!s || !categoryId || !itemId) return;
    this.closeCuotaMenu();
    this.loading.set(true);
    this.svc.setItemCard(s._id, categoryId, itemId, cardId || null).subscribe({
      next: (updated) => { this.stmt.set(updated); this.loading.set(false); toastr.success('Tarjeta cambiada', ''); },
      error: (err) => { this.loading.set(false); toastr.error(err.error?.message ?? 'Error', ''); }
    });
  }

  reassignBudgetMode(purchaseId: string, mode: 'retain' | 'defer') {
    const s = this.stmt();
    if (!s) return;
    this.loading.set(true);
    this.purchaseSvc.update(purchaseId, { budgetMode: mode }).subscribe({
      next: () => { this.load(s._id); toastr.success(mode === 'retain' ? 'Se retiene en el mes de compra' : 'Se paga en el mes de facturación', ''); },
      error: (err) => { this.loading.set(false); toastr.error(err.error?.message ?? 'Error', ''); }
    });
  }

  // Vista previa del cierre (se calcula del estado actual; el backend lo persiste al cerrar).
  closePreview = computed(() => {
    const s = this.stmt();
    if (!s) return null;
    const deposits = s.summary.savings.monthDeposits || 0;
    const withdrawals = s.summary.savings.monthWithdrawals || 0;
    const net = Math.round((deposits - withdrawals) * 100) / 100;
    const now = this.savingsBalance();
    const overspent = s.categories
      .filter(c => !c.isVirtual && c.kind !== 'savings' && (c.remaining ?? 0) < -0.001)
      .map(c => ({ name: c.name, over: Math.round(-(c.remaining ?? 0) * 100) / 100 }));
    return {
      net, deposits, withdrawals,
      savingsEnd: now,
      savingsStart: now != null ? Math.round((now - net) * 100) / 100 : null,
      apartado: s.summary.apartado || 0,
      overspent
    };
  });

  private todayIso(): string {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  load(id: string) {
    this.loading.set(true);
    this.svc.get(id).subscribe({
      next: (data) => {
        this.stmt.set(data);
        this.itemDrafts.set({});
        this.loading.set(false);
        this.loadLoans(id);
      },
      error: () => {
        this.loading.set(false);
        toastr.error('No se pudo cargar', '');
        this.router.navigate(['/months']);
      }
    });
  }

  loadLoans(statementId: string) {
    this.loanSvc.listForStatement(statementId).subscribe({
      next: (loans) => this.monthLoans.set(loans),
      error: () => {}
    });
  }

  // ----- Drafts inline -----
  draftValue(item: LsStatementItem): number {
    const d = this.itemDrafts()[item._id!];
    return d ?? item.paidAmount;
  }

  isSaving(item: LsStatementItem): boolean {
    return this.itemSaving()[item._id!] === true;
  }

  onAmountInput(item: LsStatementItem, value: number | string) {
    const num = value === '' || value === null ? 0 : Number(value);
    this.itemDrafts.update(d => ({ ...d, [item._id!]: num }));
  }

  commitAmount(item: LsStatementItem, cat: LsStatementCategory) {
    const draft = this.itemDrafts()[item._id!];
    if (draft === undefined || draft === null) return;
    if (this.isSaving(item)) return;
    if (Number(draft) === item.paidAmount) {
      this.clearDraft(item._id!);
      return;
    }
    this.sendAmount(item, cat, Number(draft));
  }

  onCheck(item: LsStatementItem, cat: LsStatementCategory, ev: Event) {
    const checked = (ev.target as HTMLInputElement).checked;
    const amount = checked ? item.budgetedAmount : 0;
    this.sendAmount(item, cat, amount);
  }

  private sendAmount(item: LsStatementItem, cat: LsStatementCategory, amount: number) {
    const s = this.stmt();
    if (!s || !item._id) return;

    if (amount > item.budgetedAmount) {
      toastr.error(`No puedes exceder ${item.budgetedAmount}`, 'Monto inválido');
      this.clearDraft(item._id);
      return;
    }
    if (amount < 0) {
      toastr.error('Monto inválido', '');
      this.clearDraft(item._id);
      return;
    }

    this.itemSaving.update(d => ({ ...d, [item._id!]: true }));

    const payload: { itemId: string; amount: number; categoryId?: string | null; purchaseId?: string | null } = {
      itemId: item._id,
      amount
    };
    if (item.purchaseId) {
      payload.purchaseId = item.purchaseId;
    } else {
      payload.categoryId = cat._id;
    }

    this.svc.setItemAmount(s._id, payload).subscribe({
      next: (updated) => {
        this.stmt.set(updated);
        this.clearDraft(item._id!);
        this.clearSaving(item._id!);
      },
      error: (err) => {
        this.clearSaving(item._id!);
        this.clearDraft(item._id!);
        toastr.error(err.error?.message ?? 'Error', '');
      }
    });
  }

  private clearDraft(itemId: string) {
    this.itemDrafts.update(d => {
      const c = { ...d };
      delete c[itemId];
      return c;
    });
  }

  private clearSaving(itemId: string) {
    this.itemSaving.update(d => {
      const c = { ...d };
      delete c[itemId];
      return c;
    });
  }

  // ----- Edit budget -----
  enterEdit() {
    const s = this.stmt();
    if (!s) return;
    this.draftSalary.set(s.salary);
    this.draftCategories.set(
      s.categories.filter(c => !c.isVirtual).map(c => ({
        _id: c._id,
        name: c.name,
        kind: c.kind,
        totalAmount: c.totalAmount || 0,
        items: c.items.map(i => ({
          _id: i._id,
          name: i.name,
          budgetedAmount: i.budgetedAmount,
          paymentMethod: i.paymentMethod === 'credit' ? 'credit' : 'cash'
        }))
      }))
    );
    this.editMode.set(true);
  }

  updateCategoryTotal(idx: number, total: number) {
    this.draftCategories.update(list => list.map((c, i) => i === idx ? { ...c, totalAmount: total } : c));
  }

  // ----- Gasto real por categoría (usa el envelope calculado por el backend) -----
  // spent = efectivo pagado + items a crédito + compras de tarjeta asignadas a la categoría
  categoryPaidSum(cat: LsStatementCategory): number {
    if (cat.spent !== undefined) return cat.spent;
    return (cat.items || []).reduce((s, i) => s + (i.paidAmount || 0), 0);
  }

  categoryBudget(cat: LsStatementCategory): number {
    if (cat.categoryBudget !== undefined) return cat.categoryBudget;
    return (cat.totalAmount && cat.totalAmount > 0) ? cat.totalAmount : this.itemsSum(cat);
  }

  categoryRemainingToPay(cat: LsStatementCategory): number {
    if (cat.remaining !== undefined) return cat.remaining;
    return this.categoryBudget(cat) - this.categoryPaidSum(cat);
  }

  // Cuánto de lo gastado viene de compras a crédito (para "también en tarjeta").
  categoryCreditConsumed(cat: LsStatementCategory): number {
    return cat.creditConsumed ?? 0;
  }

  showSpentIndicator(cat: LsStatementCategory): boolean {
    return !cat.isVirtual && cat.kind !== 'savings' &&
      (this.categoryBudget(cat) > 0 || (cat.spent ?? 0) > 0 || this.itemsSum(cat) > 0);
  }

  // Marcar/desmarcar una categoría como "cuenta para PUEDO GASTAR" (flexible).
  toggleFlexible(cat: LsStatementCategory) {
    const s = this.stmt();
    if (!s || !cat._id) return;
    this.loading.set(true);
    this.svc.updateCategoryMeta(s._id, cat._id, { flexible: !cat.flexible }).subscribe({
      next: (updated) => {
        this.stmt.set(updated);
        this.loading.set(false);
        toastr.success(!cat.flexible ? `"${cat.name}" cuenta para puedo gastar` : `"${cat.name}" ya no cuenta`, '');
      },
      error: (err) => { this.loading.set(false); toastr.error(err.error?.message ?? 'Error', ''); }
    });
  }

  catStatus(cat: LsStatementCategory): 'ok' | 'warn' | 'over' {
    const budget = this.categoryBudget(cat);
    if (budget <= 0) return 'ok';
    const p = (this.categoryPaidSum(cat) / budget) * 100;
    if (p >= 100) return 'over';
    if (p >= 70) return 'warn';
    return 'ok';
  }

  // ----- Préstamos del mes -----
  openLoanForm() {
    this.showLoanForm.set(true);
    this.loanBorrower.set('');
    this.loanAmount.set(null);
    this.loanDate.set(this.todayIso());
  }

  closeLoanForm() { this.showLoanForm.set(false); }

  submitLoan() {
    const s = this.stmt();
    if (!s) return;
    const borrowerName = this.loanBorrower().trim();
    const amount = this.loanAmount();
    if (!borrowerName) { toastr.error('Indica a quién prestas', ''); return; }
    if (!amount || amount <= 0) { toastr.error('Monto inválido', ''); return; }

    this.loading.set(true);
    this.loanSvc.create({ borrowerName, amount, lentDate: this.loanDate(), statementId: s._id }).subscribe({
      next: (loan) => {
        this.monthLoans.update(list => [loan, ...list]);
        this.svc.get(s._id).subscribe({ next: (updated) => this.stmt.set(updated) });
        this.closeLoanForm();
        this.loading.set(false);
        toastr.success('Préstamo registrado', '');
      },
      error: (err) => {
        this.loading.set(false);
        toastr.error(err.error?.message ?? 'Error', '');
      }
    });
  }

  openPayLoan(loan: LsLoan) {
    this.payingLoanId.set(loan._id);
    // Vacío a propósito: el usuario teclea cuánto cobra (parcial o total).
    // Pre-rellenar el total hacía fácil cobrar de más sin querer.
    this.loanPayAmount.set(null);
  }

  closePayLoan() {
    this.payingLoanId.set(null);
    this.loanPayAmount.set(null);
  }

  isPayingLoan(loan: LsLoan): boolean {
    return this.payingLoanId() === loan._id;
  }

  loanRemaining(loan: LsLoan): number {
    return loan.amount - (loan.paidAmount || 0);
  }

  submitPayLoan(loan: LsLoan) {
    const amount = this.loanPayAmount();
    if (!amount || amount <= 0) { toastr.error('Monto inválido', ''); return; }
    this.loading.set(true);
    this.loanSvc.pay(loan._id, amount).subscribe({
      next: ({ loan: updated, needsSavingsRepayment }) => {
        this.monthLoans.update(list => list.map(l => l._id === updated._id ? updated : l));
        const s = this.stmt();
        if (s) this.svc.get(s._id).subscribe({ next: (fresh) => this.stmt.set(fresh) });
        this.closePayLoan();
        this.loading.set(false);
        if (needsSavingsRepayment) {
          toastr.info('Cobrado. Esta plata vino de ahorros — ve a Préstamos para devolverla.', '');
        } else if (updated.status === 'paid') {
          toastr.success('Préstamo cobrado completamente', '');
        } else {
          toastr.success(`Pago parcial registrado ($${amount.toFixed(2)})`, '');
        }
      },
      error: (err) => {
        this.loading.set(false);
        toastr.error(err.error?.message ?? 'Error', '');
      }
    });
  }

  deleteLoanInDetail(loan: LsLoan) {
    if (!confirm(`¿Eliminar el préstamo a ${loan.borrowerName}?`)) return;
    const s = this.stmt();
    if (!s) return;
    this.loading.set(true);
    this.loanSvc.remove(loan._id).subscribe({
      next: () => {
        this.monthLoans.update(list => list.filter(l => l._id !== loan._id));
        this.svc.get(s._id).subscribe({ next: (fresh) => this.stmt.set(fresh) });
        this.loading.set(false);
        toastr.info('Préstamo eliminado', '');
      },
      error: (err) => {
        this.loading.set(false);
        toastr.error(err.error?.message ?? 'Error', '');
      }
    });
  }

  revertLoanPayment(loan: LsLoan) {
    if (!confirm(`¿Marcar el préstamo de ${loan.borrowerName} como NO pagado? Volverá a pendiente.`)) return;
    const s = this.stmt();
    if (!s) return;
    this.loading.set(true);
    this.loanSvc.revertPayment(loan._id).subscribe({
      next: (updated) => {
        this.monthLoans.update(list => list.map(l => l._id === updated._id ? updated : l));
        this.svc.get(s._id).subscribe({ next: (fresh) => this.stmt.set(fresh) });
        this.loading.set(false);
        toastr.info('Cobro revertido — vuelve a pendiente', '');
      },
      error: (err) => { this.loading.set(false); toastr.error(err.error?.message ?? 'Error', ''); }
    });
  }

  pendingLoans = computed(() => this.monthLoans().filter(l => l.status === 'pending'));

  // ----- Shared card cuotas (tarjeta prestada) -----
  openPayBorrower(cuota: LsStatementItem) {
    this.payingBorrowerCuotaId.set(cuota.cuotaId ?? null);
    const remaining = cuota.budgetedAmount - (cuota.paidByBorrower || 0);
    this.borrowerPayAmount.set(remaining);
  }

  closePayBorrower() {
    this.payingBorrowerCuotaId.set(null);
    this.borrowerPayAmount.set(null);
  }

  isPayingBorrower(cuota: LsStatementItem): boolean {
    return this.payingBorrowerCuotaId() === cuota.cuotaId;
  }

  borrowerRemaining(cuota: LsStatementItem): number {
    return cuota.budgetedAmount - (cuota.paidByBorrower || 0);
  }

  submitPayBorrower(cuota: LsStatementItem) {
    const s = this.stmt();
    if (!s || !cuota.purchaseId || !cuota.cuotaId) return;
    const amount = this.borrowerPayAmount();
    if (!amount || amount <= 0) { toastr.error('Monto inválido', ''); return; }
    this.loading.set(true);
    this.purchaseSvc.payBorrowerCuota(cuota.purchaseId, cuota.cuotaId, amount).subscribe({
      next: () => {
        this.svc.get(s._id).subscribe({ next: (fresh) => this.stmt.set(fresh) });
        this.closePayBorrower();
        this.loading.set(false);
        toastr.success(`Cobrado $${amount.toFixed(2)} de ${cuota.borrowerName}`, '');
      },
      error: (err) => {
        this.loading.set(false);
        toastr.error(err.error?.message ?? 'Error', '');
      }
    });
  }

  convertCuotaToLoan(cuota: LsStatementItem) {
    const s = this.stmt();
    if (!s || !cuota.purchaseId || !cuota.cuotaId) return;
    const remaining = this.borrowerRemaining(cuota);
    if (!confirm(`¿Convertir el saldo pendiente de ${cuota.borrowerName} ($${remaining.toFixed(2)}) en un préstamo?`)) return;
    this.loading.set(true);
    this.purchaseSvc.convertCuotaToLoan(cuota.purchaseId, cuota.cuotaId).subscribe({
      next: ({ loan }) => {
        this.monthLoans.update(list => [loan, ...list]);
        this.svc.get(s._id).subscribe({ next: (fresh) => this.stmt.set(fresh) });
        this.loading.set(false);
        toastr.info(`Préstamo creado para ${loan.borrowerName} — verás el detalle en la sección Préstamos`, '');
      },
      error: (err) => {
        this.loading.set(false);
        toastr.error(err.error?.message ?? 'Error', '');
      }
    });
  }

  // ----- Agregar item inline desde detalle -----
  itemsSum(cat: LsStatementCategory): number {
    return (cat.items || []).reduce((s, it) => s + (it.budgetedAmount || 0), 0);
  }

  categoryFreeAmount(cat: LsStatementCategory): number {
    if (cat.totalAmount && cat.totalAmount > 0) {
      return cat.totalAmount - this.itemsSum(cat);
    }
    const s = this.stmt();
    if (!s) return 0;
    return s.summary.availableToBudget;
  }

  private defaultCardId(): string | null {
    let last: string | null = null;
    try { last = localStorage.getItem(LAST_CARD_KEY); } catch { /* no storage */ }
    const active = this.activeCards();
    return (active.find(c => c._id === last) || active[0])?._id ?? null;
  }

  openAddItem(cat: LsStatementCategory) {
    if (!cat._id) return;
    this.addingForCategory.set(cat._id);
    this.newItemName.set('');
    this.newItemAmount.set(null);
    this.newItemPaymentMethod.set('cash');
    this.newItemCardId.set(this.defaultCardId());
  }

  closeAddItem() {
    this.addingForCategory.set(null);
  }

  toggleNewItemCredit() {
    this.newItemPaymentMethod.update(m => m === 'credit' ? 'cash' : 'credit');
    if (this.newItemPaymentMethod() === 'credit' && !this.newItemCardId()) {
      this.newItemCardId.set(this.defaultCardId());
    }
  }

  isAddingTo(cat: LsStatementCategory): boolean {
    return this.addingForCategory() === cat._id;
  }

  submitAddItem(cat: LsStatementCategory) {
    const s = this.stmt();
    if (!s || !cat._id) return;
    const name = this.newItemName().trim();
    const amount = this.newItemAmount() ?? 0;
    const paymentMethod = this.newItemPaymentMethod();
    const cardId = paymentMethod === 'credit' ? this.newItemCardId() : null;
    if (!name) { toastr.error('Nombre requerido', ''); return; }

    // Sobregiro: si el item excede el presupuesto (envelope) de la categoría, compensar.
    const budget = this.categoryBudget(cat);
    if (budget > 0) {
      const remaining = this.categoryRemainingToPay(cat);
      if (amount > remaining + 0.001) {
        this.startCompensation(cat, amount - remaining, { kind: 'add', cat, name, amount, paymentMethod, cardId, paid: false });
        return;
      }
    }
    this.doAddItem(cat, name, amount, paymentMethod, cardId);
  }

  private doAddItem(cat: LsStatementCategory, name: string, amount: number, paymentMethod: 'cash' | 'credit', cardId: string | null = null, paid = false) {
    const s = this.stmt();
    if (!s || !cat._id) return;
    if (paymentMethod === 'credit' && cardId) { try { localStorage.setItem(LAST_CARD_KEY, cardId); } catch { /* no storage */ } }
    this.loading.set(true);
    this.svc.addItemToCategory(s._id, cat._id, { name, budgetedAmount: amount, paymentMethod, cardId, paid }).subscribe({
      next: (updated) => {
        this.stmt.set(updated);
        this.closeAddItem();
        this.loading.set(false);
        toastr.success('Item agregado', '');
      },
      error: (err) => {
        this.loading.set(false);
        toastr.error(err.error?.message ?? 'Error', '');
      }
    });
  }

  // ----- Compensación de sobregiro (Fase 4) -----
  compSources = computed(() => {
    const target = this.compTarget();
    const s = this.stmt();
    if (!target || !s) return [] as { cat: LsStatementCategory; free: number }[];
    return s.categories
      .filter(c => !c.isVirtual && c._id !== target._id && (c.totalAmount ?? 0) > 0)
      .map(c => ({ cat: c, free: (c.totalAmount ?? 0) - this.itemsSum(c) }))
      .filter(x => x.free > 0.001)
      .sort((a, b) => b.free - a.free);
  });

  private startCompensation(target: LsStatementCategory, overflow: number, pending: CompPending) {
    this.compTarget.set(target);
    this.compOverflow.set(Math.round(overflow * 100) / 100);
    this.compSourceId.set(this.compSources()[0]?.cat._id ?? null);
    this.compPending = pending;
  }

  cancelCompensation() {
    this.compTarget.set(null);
    this.compSourceId.set(null);
    this.compPending = null;
  }

  confirmCompensation() {
    const target = this.compTarget();
    const sourceId = this.compSourceId();
    const s = this.stmt();
    if (!target || !target._id || !sourceId || !s) { toastr.error('Elige una categoría para compensar', ''); return; }
    const amount = this.compOverflow();
    const pending = this.compPending;
    this.loading.set(true);
    this.svc.compensate(s._id, { fromCategoryId: sourceId, toCategoryId: target._id, amount }).subscribe({
      next: (updated) => {
        this.stmt.set(updated);
        this.loading.set(false);
        const freshCat = updated.categories.find(c => c._id === target._id) ?? target;
        this.cancelCompensation();
        toastr.success('Presupuesto compensado', '');
        if (pending?.kind === 'add') this.doAddItem(freshCat, pending.name, pending.amount, pending.paymentMethod, pending.cardId, pending.paid);
        else if (pending?.kind === 'purchase') this.doCreatePurchase(pending.payload, pending.typeLabel, pending.statementId);
      },
      error: (err) => { this.loading.set(false); toastr.error(err.error?.message ?? 'Error', ''); }
    });
  }

  // ----- Cierre de mes (Fase 4) -----
  openClose() { this.showClose.set(true); }
  closeCloseModal() { this.showClose.set(false); }

  confirmCloseMonth() {
    const s = this.stmt();
    if (!s) return;
    this.loading.set(true);
    this.svc.close(s._id).subscribe({
      next: (updated) => {
        this.stmt.set(updated);
        this.loading.set(false);
        this.showClose.set(false);
        toastr.success('Mes cerrado', '');
      },
      error: (err) => { this.loading.set(false); toastr.error(err.error?.message ?? 'Error', ''); }
    });
  }

  reopenMonth() {
    const s = this.stmt();
    if (!s) return;
    if (!confirm('¿Reabrir el mes? Se borrará el resumen de cierre.')) return;
    this.loading.set(true);
    this.svc.reopen(s._id).subscribe({
      next: (updated) => { this.stmt.set(updated); this.loading.set(false); toastr.info('Mes reabierto', ''); },
      error: (err) => { this.loading.set(false); toastr.error(err.error?.message ?? 'Error', ''); }
    });
  }

  removeItemInline(cat: LsStatementCategory, item: LsStatementItem) {
    const s = this.stmt();
    if (!s || !cat._id || !item._id) return;

    // Si ya hay un delete pendiente, comitearlo antes de programar este
    this.flushPendingDelete();

    const itemId = item._id;
    const categoryId = cat._id;
    const statementId = s._id;
    const name = item.name;

    const timer = setTimeout(() => this.commitDelete(itemId), this.UNDO_DELAY_MS);
    this.pendingDelete.set({
      statementId,
      categoryId,
      itemId,
      name,
      timer,
      deadline: Date.now() + this.UNDO_DELAY_MS
    });
  }

  isDeletingItem(itemId?: string): boolean {
    if (!itemId) return false;
    return this.pendingDelete()?.itemId === itemId;
  }

  undoDelete() {
    const p = this.pendingDelete();
    if (!p) return;
    clearTimeout(p.timer);
    this.pendingDelete.set(null);
  }

  flushPendingDelete() {
    const p = this.pendingDelete();
    if (!p) return;
    clearTimeout(p.timer);
    this.commitDelete(p.itemId);
  }

  private commitDelete(itemId: string) {
    const p = this.pendingDelete();
    if (!p || p.itemId !== itemId) return;
    const { statementId, categoryId } = p;
    this.pendingDelete.set(null);
    this.svc.removeItemFromCategory(statementId, categoryId, itemId).subscribe({
      next: (updated) => this.stmt.set(updated),
      error: (err) => {
        toastr.error(err.error?.message ?? 'No se pudo eliminar', '');
        // Recargar para resincronizar en caso de error
        if (this.stmt()) this.load(this.stmt()!._id);
      }
    });
  }

  ngOnDestroy() {
    // Si quedó un delete pendiente al salir, comitearlo
    this.flushPendingDelete();
  }

  cancelEdit() { this.editMode.set(false); }

  addCategory() {
    this.draftCategories.update(list => [...list, { name: 'Nueva categoría', kind: 'expense', totalAmount: 0, items: [] }]);
  }

  removeCategory(idx: number) {
    this.draftCategories.update(list => list.filter((_, i) => i !== idx));
  }

  updateCategoryName(idx: number, name: string) {
    this.draftCategories.update(list => list.map((c, i) => i === idx ? { ...c, name } : c));
  }

  updateCategoryKind(idx: number, kind: CategoryKind) {
    this.draftCategories.update(list => list.map((c, i) => i === idx ? { ...c, kind } : c));
  }

  addItem(catIdx: number) {
    this.draftCategories.update(list => list.map((c, i) =>
      i === catIdx ? { ...c, items: [...c.items, { name: 'Nuevo item', budgetedAmount: 0, paymentMethod: 'cash' as const }] } : c
    ));
  }

  toggleDraftItemCredit(catIdx: number, itemIdx: number) {
    this.draftCategories.update(list => list.map((c, i) => {
      if (i !== catIdx) return c;
      return {
        ...c,
        items: c.items.map((it, j) => j === itemIdx
          ? { ...it, paymentMethod: it.paymentMethod === 'credit' ? 'cash' as const : 'credit' as const }
          : it)
      };
    }));
  }

  isCreditItem(it: { paymentMethod?: 'cash' | 'credit' }): boolean {
    return it.paymentMethod === 'credit';
  }

  removeItem(catIdx: number, itemIdx: number) {
    this.draftCategories.update(list => list.map((c, i) =>
      i === catIdx ? { ...c, items: c.items.filter((_, j) => j !== itemIdx) } : c
    ));
  }

  updateItemName(catIdx: number, itemIdx: number, name: string) {
    this.draftCategories.update(list => list.map((c, i) =>
      i === catIdx ? { ...c, items: c.items.map((it, j) => j === itemIdx ? { ...it, name } : it) } : c
    ));
  }

  updateItemAmount(catIdx: number, itemIdx: number, amount: number) {
    this.draftCategories.update(list => list.map((c, i) =>
      i === catIdx ? { ...c, items: c.items.map((it, j) => j === itemIdx ? { ...it, budgetedAmount: amount } : it) } : c
    ));
  }

  saveEdit() {
    const s = this.stmt();
    if (!s) return;
    if (this.draftTotalBudgeted() > this.draftSalary()) {
      toastr.error(`El presupuesto excede al sueldo en ${(this.draftTotalBudgeted() - this.draftSalary()).toFixed(2)}`, 'Inválido');
      return;
    }
    this.loading.set(true);
    this.svc.update(s._id, {
      salary: this.draftSalary(),
      categories: this.draftCategories() as LsStatementCategory[]
    }).subscribe({
      next: (updated) => {
        this.stmt.set(updated);
        this.editMode.set(false);
        this.loading.set(false);
        toastr.success('Cambios guardados', '');
      },
      error: (err) => {
        this.loading.set(false);
        toastr.error(err.error?.message ?? 'Error', '');
      }
    });
  }

  // ----- Unified transaction form -----
  openTx(type: TxType) {
    this.txType.set(type);
    this.txName.set('');
    this.txAmount.set(null);
    this.txCategoryName.set('');
    this.txDate.set(this.todayIso());
    this.txInstallments.set(2);
    this.txIsShared.set(false);
    this.txBorrowerName.set('');
    this.txPurchaseCategory.set('');
    this.txBudgetMode.set('retain');
    this.txSavingsSource.set('');
    if (type === 'ahorro') this.txName.set('Ahorro');
    // Tarjeta por defecto: la última usada, si sigue activa; si no, la primera activa.
    let last: string | null = null;
    try { last = localStorage.getItem(LAST_CARD_KEY); } catch { /* no storage */ }
    const active = this.activeCards();
    const pick = active.find(c => c._id === last) || active[0];
    this.txCardId.set(pick?._id ?? null);
    this.showTx.set(true);
  }

  closeTx() { this.showTx.set(false); }

  // ----- Navegador de secciones -----
  toggleNav() { this.showNav.update(v => !v); }
  closeNav() { this.showNav.set(false); }

  /** Salta a una sección del mes y cierra el navegador. Resalta extras al ir ahí. */
  navTo(id: string) {
    this.showNav.set(false);
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (id === 'extras-section') {
      this.flashExtras.set(true);
      setTimeout(() => this.flashExtras.set(false), 1500);
    }
  }

  submitTx() {
    const s = this.stmt();
    if (!s) return;
    const name = this.txName().trim();
    const amount = this.txAmount();
    if (!name || amount === null || amount <= 0) {
      toastr.error('Nombre y monto requeridos', '');
      return;
    }

    const type = this.txType();
    this.loading.set(true);

    if (type === 'ahorro') {
      const srcId = this.txSavingsSource();
      const srcCat = srcId ? s.categories.find(c => c._id === srcId) : null;
      // Origen categoría: validar que tenga restante suficiente.
      if (srcCat && this.categoryBudget(srcCat) > 0) {
        const remaining = this.categoryRemainingToPay(srcCat);
        if (amount > remaining + 0.001) {
          this.loading.set(false);
          toastr.error(`"${srcCat.name}" solo tiene ${remaining.toFixed(2)} disponible. Elige otro origen o menos monto.`, '');
          return;
        }
      }
      this.svc.createSavings(s._id, { amount, name, categoryId: srcId || null }).subscribe({
        next: (updated) => {
          this.stmt.set(updated);
          this.refreshSavings();
          this.closeTx();
          this.loading.set(false);
          toastr.success(`Ahorro de $${amount.toFixed(2)} enviado a tu cuenta de ahorros`, '');
        },
        error: (err) => { this.loading.set(false); toastr.error(err.error?.message ?? 'Error', ''); }
      });
      return;
    }

    if (type === 'expense' || type === 'income') {
      const catName = this.txCategoryName().trim();
      const matchedCat = catName
        ? s.categories.find(c => !c.isVirtual && c.name.trim().toLowerCase() === catName.toLowerCase())
        : null;

      // Gasto asignado a una categoría real → item PAGADO en esa categoría (con validación
      // de sobregiro). Sin categoría (o ingreso) → movimiento extra no presupuestado.
      if (type === 'expense' && matchedCat) {
        const budget = this.categoryBudget(matchedCat);
        if (budget > 0) {
          const remaining = this.categoryRemainingToPay(matchedCat);
          if (amount > remaining + 0.001) {
            this.loading.set(false);
            this.closeTx();
            this.startCompensation(matchedCat, amount - remaining,
              { kind: 'add', cat: matchedCat, name, amount, paymentMethod: 'cash', cardId: null, paid: true });
            return;
          }
        }
        this.closeTx();
        this.doAddItem(matchedCat, name, amount, 'cash', null, true);
        return;
      }

      const extraType: ExtraType = type === 'income' ? 'income' : 'expense';
      this.svc.addExtra(s._id, {
        name,
        amount,
        type: extraType,
        categoryName: catName,
        date: this.txDate()
      }).subscribe({
        next: (updated) => {
          this.stmt.set(updated);
          this.closeTx();
          this.loading.set(false);
          toastr.success(type === 'income' ? 'Ingreso registrado' : 'Gasto registrado', '');
        },
        error: (err) => {
          this.loading.set(false);
          toastr.error(err.error?.message ?? 'Error', '');
        }
      });
    } else {
      const installments = type === 'diferido' ? Math.max(2, this.txInstallments()) : 1;
      const isShared = this.txIsShared();
      const borrowerName = this.txBorrowerName().trim();
      if (isShared && !borrowerName) {
        toastr.error('Indica el nombre de quien usó la tarjeta', '');
        this.loading.set(false);
        return;
      }
      const categoryName = this.txPurchaseCategory().trim();
      const payload = {
        name,
        totalAmount: amount,
        purchaseDate: this.txDate(),
        installments,
        isShared: isShared || undefined,
        borrowerName: isShared ? borrowerName : undefined,
        cardId: this.txCardId(),
        categoryName: categoryName || undefined,
        // Antes del corte se paga este mismo mes → siempre 'retain' (descuenta ahora).
        budgetMode: this.txCrossesCutoff() ? this.txBudgetMode() : 'retain'
      };
      const typeLabel = type === 'diferido' ? 'Diferido registrado' : 'Compra TDC registrada';

      // Sobregiro: compra propia asignada a una categoría cuyo consumo de ESTE mes
      // (una cuota) excede lo que queda. Se pregunta de dónde compensar antes de guardar.
      if (!isShared && categoryName) {
        const cat = s.categories.find(c => !c.isVirtual && c.name === categoryName);
        const consumedNow = installments > 1 ? amount / installments : amount;
        const purchMonth = new Date(this.txDate()).getMonth() + 1;
        const purchYear = new Date(this.txDate()).getFullYear();
        const budgetHitsThisMonth = installments === 1 ? (purchMonth === s.month && purchYear === s.year) : false;
        if (cat && this.categoryBudget(cat) > 0 && budgetHitsThisMonth) {
          const remaining = this.categoryRemainingToPay(cat);
          if (consumedNow > remaining + 0.001) {
            this.loading.set(false);
            this.startCompensation(cat, consumedNow - remaining, { kind: 'purchase', payload, typeLabel, statementId: s._id });
            return;
          }
        }
      }
      this.doCreatePurchase(payload, typeLabel, s._id);
    }
  }

  private doCreatePurchase(payload: any, typeLabel: string, statementId: string) {
    this.loading.set(true);
    if (payload.cardId) { try { localStorage.setItem(LAST_CARD_KEY, payload.cardId); } catch { /* no storage */ } }
    this.purchaseSvc.create(payload).subscribe({
      next: () => {
        this.closeTx();
        this.load(statementId);
        toastr.success(typeLabel, '');
      },
      error: (err) => {
        this.loading.set(false);
        toastr.error(err.error?.message ?? 'Error', '');
      }
    });
  }

  // Mover un movimiento extra a una categoría: lo vuelve un item PAGADO en ella y borra el extra.
  moveExtraToCategory(extra: LsStatementExtra, categoryName: string) {
    const s = this.stmt();
    if (!s || !extra._id || !categoryName) return;
    const cat = s.categories.find(c => !c.isVirtual && c.name === categoryName);
    if (!cat || !cat._id) return;
    const budget = this.categoryBudget(cat);
    if (budget > 0) {
      const remaining = this.categoryRemainingToPay(cat);
      if (extra.amount > remaining + 0.001) {
        toastr.error(`Excede "${categoryName}" por ${(extra.amount - remaining).toFixed(2)}. Ajusta el presupuesto primero.`, '');
        return;
      }
    }
    const extraId = extra._id;
    this.loading.set(true);
    this.svc.addItemToCategory(s._id, cat._id, { name: extra.name, budgetedAmount: extra.amount, paymentMethod: 'cash', paid: true }).subscribe({
      next: () => {
        this.svc.removeExtra(s._id, extraId).subscribe({
          next: (updated) => { this.stmt.set(updated); this.loading.set(false); toastr.success(`Movido a ${categoryName}`, ''); },
          error: () => { this.loading.set(false); this.load(s._id); }
        });
      },
      error: (err) => { this.loading.set(false); toastr.error(err.error?.message ?? 'No se pudo mover (¿excede el presupuesto?)', ''); }
    });
  }

  removeExtra(extraId: string) {
    const s = this.stmt();
    if (!s) return;
    if (!confirm('¿Eliminar este movimiento?')) return;
    this.svc.removeExtra(s._id, extraId).subscribe({
      next: (updated) => {
        this.stmt.set(updated);
        this.refreshSavings();
        toastr.info('Eliminado', '');
      },
      error: (err) => toastr.error(err.error?.message ?? 'Error', '')
    });
  }

  private refreshSavings() {
    this.accountSvc.list().subscribe({
      next: (accs) => {
        const sav = accs.find(a => a.type === 'savings');
        this.savingsBalance.set(sav ? sav.balance : null);
      },
      error: () => {}
    });
  }

  // ----- Toggle credit group (TDC / Diferidos category check) -----
  toggleGroup(cat: LsStatementCategory, ev: Event) {
    const s = this.stmt();
    if (!s) return;
    const checked = (ev.target as HTMLInputElement).checked;

    this.loading.set(true);
    this.svc.toggleCreditGroup(s._id, { paid: checked }).subscribe({
      next: (updated) => {
        this.stmt.set(updated);
        this.loading.set(false);
        toastr.success(checked ? 'Tarjeta marcada como pagada' : 'Tarjeta desmarcada', '');
      },
      error: (err) => {
        this.loading.set(false);
        toastr.error(err.error?.message ?? 'Error', '');
      }
    });
  }

  payCard(cb: LsCardBreakdown, ev: Event) {
    const s = this.stmt();
    if (!s) return;
    const checked = (ev.target as HTMLInputElement).checked;
    this.loading.set(true);
    this.svc.toggleCard(s._id, { cardId: cb.cardId, paid: checked }).subscribe({
      next: (updated) => {
        this.stmt.set(updated);
        this.loading.set(false);
        toastr.success(`${cb.name} ${checked ? 'pagada' : 'desmarcada'}`, '');
      },
      error: (err) => {
        this.loading.set(false);
        toastr.error(err.error?.message ?? 'Error', '');
      }
    });
  }

  // ----- Convert movement type -----
  private askInstallments(): number | null {
    const n = parseInt(prompt('Número de cuotas (mín 2)', '2') || '0', 10);
    if (!n || n < 2) { toastr.error('Cuotas inválidas', ''); return null; }
    return n;
  }

  private runConvert(payload: { source: any; target: any }) {
    const s = this.stmt();
    if (!s) return;
    this.loading.set(true);
    this.svc.convertMovement(s._id, payload).subscribe({
      next: (updated) => {
        this.stmt.set(updated);
        this.loading.set(false);
        toastr.success('Convertido', '');
      },
      error: (err) => {
        this.loading.set(false);
        toastr.error(err.error?.message ?? 'Error', '');
      }
    });
  }

  convertItem(cat: LsStatementCategory, item: LsStatementItem, newType: 'expense' | 'income' | 'tdc' | 'diferido') {
    let installments = 1;
    if (newType === 'diferido') {
      const n = this.askInstallments();
      if (!n) return;
      installments = n;
    }
    this.runConvert({
      source: { kind: 'item', categoryId: cat._id, itemId: item._id },
      target: { type: newType, installments, categoryName: cat.name }
    });
  }

  convertExtra(extra: { _id?: string; linkedSavingsId?: string | null }, newType: 'expense' | 'income' | 'tdc' | 'diferido') {
    if (!extra._id) return;
    if (extra.linkedSavingsId) {
      toastr.error('Este ingreso proviene de un egreso de ahorros. Gestiónalo desde Cuentas.', '');
      return;
    }
    let installments = 1;
    if (newType === 'diferido') {
      const n = this.askInstallments();
      if (!n) return;
      installments = n;
    }
    this.runConvert({
      source: { kind: 'extra', extraId: extra._id },
      target: { type: newType, installments }
    });
  }

  convertCuota(item: LsStatementItem, newType: 'expense' | 'income' | 'tdc' | 'diferido') {
    if (!item.purchaseId) return;
    if (!confirm('Esto eliminará la compra completa (todas sus cuotas) y la recreará como el nuevo tipo. ¿Continuar?')) return;
    let installments = 1;
    if (newType === 'diferido') {
      const n = this.askInstallments();
      if (!n) return;
      installments = n;
    }
    this.runConvert({
      source: { kind: 'purchase', purchaseId: item.purchaseId },
      target: { type: newType, installments }
    });
  }

  // ----- Exportar mes (.txt / portapapeles) -----
  openExport() { this.showExport.set(true); }
  closeExport() { this.showExport.set(false); }
  setExportFormat(f: 'mine' | 'structured') { this.exportFormat.set(f); }

  copyExport() {
    const text = this.exportText();
    if (!text) return;
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(
        () => toastr.success('Copiado al portapapeles', ''),
        () => this.fallbackCopy(text)
      );
    } else {
      this.fallbackCopy(text);
    }
  }

  private fallbackCopy(text: string) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      toastr.success('Copiado al portapapeles', '');
    } catch {
      toastr.error('No se pudo copiar', '');
    }
  }

  downloadExport() {
    const s = this.stmt();
    const text = this.exportText();
    if (!s || !text) return;
    const fileName = `plan-${MONTH_NAMES[s.month - 1].toLowerCase()}-${s.year}.txt`;
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toastr.success('Archivo descargado', '');
  }

  // Formatea montos: enteros sin decimales, resto con 2 (matchea el estilo manual)
  private fmt(n: number): string {
    const r = Math.round((Number(n) || 0) * 100) / 100;
    return Number.isInteger(r) ? String(r) : r.toFixed(2);
  }

  // Alinea "right" a la derecha en un ancho fijo (formato estructurado monoespaciado)
  private row(left: string, right: string, total = 36): string {
    const space = Math.max(1, total - left.length - right.length);
    return left + ' '.repeat(space) + right;
  }

  private isItemFullyPaid(it: LsStatementItem): boolean {
    return it.isPaid || (it.paidAmount > 0 && it.paidAmount >= it.budgetedAmount);
  }

  // Reconciliación de ahorros anclada al saldo REAL de la cuenta de ahorros.
  // prev = saldoReal - (depósitos - retiros del mes); así refleja cualquier
  // transferencia/retiro y nunca asume una suma acumulada mes a mes.
  private savingsInfo(s: LsMonthlyStatement): { now: number; prev: number; deposits: number; withdrawals: number } | null {
    const now = this.savingsBalance();
    if (now == null) return null;
    const deposits = s.summary.savings.monthDeposits || 0;
    const withdrawals = s.summary.savings.monthWithdrawals || 0;
    const prev = now - (deposits - withdrawals);
    return { now, prev, deposits, withdrawals };
  }

  // ---- Formato fiel al estilo manual de David ----
  private buildMineFormat(s: LsMonthlyStatement, loans: LsLoan[]): string {
    const L: string[] = [];
    L.push(`PLAN ${MONTH_NAMES[s.month - 1].toUpperCase()} ${s.year}`);
    L.push(`SUELDO: ${this.fmt(s.salary)}`);
    L.push('');

    for (const cat of s.categories) {
      if (cat.isVirtual) {
        const estado = cat.categoryPaid ? 'pagada' : 'pendiente';
        L.push(`* ${cat.name.toUpperCase()}: ${this.fmt(cat.totalAll || 0)} (${estado})`);
        for (const it of cat.items) {
          const tag = it.isShared && it.borrowerName ? ` [${it.borrowerName}]` : '';
          const dif = it.subType === 'diferido' ? ' (diferido)' : '';
          L.push(`${it.name}: ${this.fmt(it.budgetedAmount)}${tag}${dif}`);
        }
        for (const ext of cat.externalCreditItems || []) {
          L.push(`${ext.name}: ${this.fmt(ext.amount)} (${ext.categoryName})`);
        }
        L.push('');
        continue;
      }

      const budget = this.categoryBudget(cat);
      const paid = this.categoryPaidSum(cat);
      L.push(`* ${cat.name.toUpperCase()}: ${this.fmt(budget)}`);
      for (const it of cat.items) {
        L.push(this.mineItemLine(it));
      }
      L.push(`RESTANTE: ${this.fmt(budget - paid)}`);
      L.push('');
    }

    if (s.extras.length) {
      L.push('*EXTRAS');
      for (const e of s.extras.filter(x => x.type === 'expense')) {
        L.push(`-${e.name}: ${this.fmt(e.amount)}`);
      }
      for (const e of s.extras.filter(x => x.type === 'income')) {
        L.push(`+${e.name}: ${this.fmt(e.amount)}`);
      }
      L.push('');
    }

    if (loans.length) {
      L.push('*PRÉSTAMOS');
      for (const ln of loans) {
        const remaining = ln.amount - (ln.paidAmount || 0);
        if (ln.status === 'paid') {
          L.push(`${ln.borrowerName}: pagado (${this.fmt(ln.paidAmount)})`);
        } else if ((ln.paidAmount || 0) > 0) {
          L.push(`${ln.borrowerName} debe: ${this.fmt(ln.amount)} - (${this.fmt(ln.paidAmount)})`);
        } else {
          L.push(`${ln.borrowerName} debe: ${this.fmt(remaining)}`);
        }
      }
      L.push('');
    }

    L.push('--- RESUMEN ---');
    L.push(`Presupuestado: ${this.fmt(s.summary.totalBudgeted)}`);
    L.push(`Gastado: ${this.fmt(s.summary.totalPaid + s.summary.totalExtras)}`);
    L.push(`Disponible gastos yo: ${this.fmt(s.summary.puedoGastar)}`);
    if (s.summary.avance > 0) {
      L.push(`Avance (tarjeta a pagar): ${this.fmt(s.summary.avance)}`);
    }
    if (s.summary.presupuestoExcedido > 0) {
      L.push(`Presupuesto excedido: ${this.fmt(s.summary.presupuestoExcedido)}`);
    }
    L.push(`Ingresos extra: ${this.fmt(s.summary.sinCategoria.extraAvailable)}`);
    if (s.summary.creditCard.total > 0) {
      L.push(`Tarjeta: ${this.fmt(s.summary.creditCard.total)} (${s.summary.creditCard.groupPaid ? 'pagada' : 'pendiente'})`);
    }
    L.push(`Saldo en cuenta: ${this.fmt(s.summary.saldoEnCuenta)}`);
    L.push(`Saldo a tener (con préstamos): ${this.fmt(s.summary.saldoATener)}`);
    if (s.summary.creditCard.pending > 0) {
      L.push(`Disponible real (pagando mi tarjeta): ${this.fmt(s.summary.disponibleReal)}`);
    }

    const sav = this.savingsInfo(s);
    if (sav) {
      L.push('');
      L.push(`AHORROS mes anterior: ${this.fmt(sav.prev)}`);
      L.push(`+ Ahorro este mes: ${this.fmt(sav.deposits)}`);
      if (sav.withdrawals > 0) {
        L.push(`- Retirado de ahorros: ${this.fmt(sav.withdrawals)}`);
      }
      L.push(`AHORROS total (real): ${this.fmt(sav.now)}`);
    } else if (s.summary.savings.monthDeposits > 0) {
      L.push(`Ahorro este mes: +${this.fmt(s.summary.savings.monthDeposits)}`);
    }

    return L.join('\n');
  }

  private mineItemLine(it: LsStatementItem): string {
    const credit = it.paymentMethod === 'credit' ? ' [tarjeta]' : '';
    const base = `${it.name}: ${this.fmt(it.budgetedAmount)}${credit}`;
    if (this.isItemFullyPaid(it)) return `${base} - X`;
    if (it.paidAmount > 0) return `${base} - (${this.fmt(it.paidAmount)})`;
    return base;
  }

  // ---- Formato estructurado (alineado, con símbolos de estado) ----
  private buildStructuredFormat(s: LsMonthlyStatement, loans: LsLoan[]): string {
    const L: string[] = [];
    L.push(`==== ${MONTH_NAMES[s.month - 1].toUpperCase()} ${s.year} ====`);
    L.push(this.row('Sueldo', this.fmt(s.salary)));
    L.push(this.row('Presupuestado', this.fmt(s.summary.totalBudgeted)));
    L.push(this.row('Gastado', this.fmt(s.summary.totalPaid + s.summary.totalExtras)));
    L.push(this.row('Disponible gastos yo', this.fmt(s.summary.puedoGastar)));
    if (s.summary.avance > 0) {
      L.push(this.row('Avance (tarjeta a pagar)', this.fmt(s.summary.avance)));
    }
    if (s.summary.presupuestoExcedido > 0) {
      L.push(this.row('Presupuesto excedido', this.fmt(s.summary.presupuestoExcedido)));
    }
    L.push(this.row('Ingresos extra', this.fmt(s.summary.sinCategoria.extraAvailable)));
    L.push(this.row('Saldo en cuenta', this.fmt(s.summary.saldoEnCuenta)));
    L.push(this.row('Saldo a tener', this.fmt(s.summary.saldoATener)));
    if (s.summary.creditCard.pending > 0) {
      L.push(this.row('Disponible real', this.fmt(s.summary.disponibleReal)));
    }
    L.push('');

    for (const cat of s.categories) {
      if (cat.isVirtual) {
        const estado = cat.categoryPaid ? 'pagada' : 'pendiente';
        L.push(this.row(`■ ${cat.name.toUpperCase()} · ${estado}`, `(${this.fmt(cat.totalAll || 0)})`));
        for (const it of cat.items) {
          const tag = it.isShared && it.borrowerName ? ` [${it.borrowerName}]` : '';
          L.push(this.row(`  · ${it.name}${tag}`, this.fmt(it.budgetedAmount)));
        }
        for (const ext of cat.externalCreditItems || []) {
          L.push(this.row(`  · ${ext.name} (${ext.categoryName})`, this.fmt(ext.amount)));
        }
        L.push('');
        continue;
      }

      const budget = this.categoryBudget(cat);
      const paid = this.categoryPaidSum(cat);
      L.push(this.row(`■ ${cat.name.toUpperCase()}`, `(${this.fmt(budget)})`));
      for (const it of cat.items) {
        L.push(this.structuredItemLine(it));
      }
      L.push(this.row('  Restante:', this.fmt(budget - paid)));
      L.push('');
    }

    if (s.extras.length) {
      L.push('■ EXTRAS');
      for (const e of s.extras) {
        const sign = e.type === 'income' ? '+' : '-';
        const catName = e.categoryName ? ` (${e.categoryName})` : '';
        L.push(this.row(`  ${sign} ${e.name}${catName}`, sign + this.fmt(e.amount)));
      }
      L.push('');
    }

    if (loans.length) {
      L.push('■ PRÉSTAMOS');
      for (const ln of loans) {
        const remaining = ln.amount - (ln.paidAmount || 0);
        const label = ln.status === 'paid'
          ? 'cobrado'
          : ((ln.paidAmount || 0) > 0 ? `debe (cobrado ${this.fmt(ln.paidAmount)})` : 'debe');
        const amount = ln.status === 'paid' ? '+' + this.fmt(ln.paidAmount) : this.fmt(remaining);
        L.push(this.row(`  ${ln.borrowerName} · ${label}`, amount));
      }
      L.push('');
    }

    const sav = this.savingsInfo(s);
    if (sav) {
      L.push('■ AHORROS');
      L.push(this.row('  Mes anterior', this.fmt(sav.prev)));
      L.push(this.row('  + Ahorro este mes', '+' + this.fmt(sav.deposits)));
      if (sav.withdrawals > 0) {
        L.push(this.row('  - Retirado', '-' + this.fmt(sav.withdrawals)));
      }
      L.push(this.row('  Total (real)', this.fmt(sav.now)));
      L.push('');
    } else if (s.summary.savings.monthDeposits > 0) {
      L.push('■ AHORROS');
      L.push(this.row('  Ahorro este mes', '+' + this.fmt(s.summary.savings.monthDeposits)));
      L.push('');
    }

    return L.join('\n').trimEnd();
  }

  private structuredItemLine(it: LsStatementItem): string {
    let mark = '·';
    if (this.isItemFullyPaid(it)) mark = '✓';
    else if (it.paidAmount > 0) mark = '◐';
    const credit = it.paymentMethod === 'credit' ? ' [tdc]' : '';
    const left = `  ${mark} ${it.name}${credit}`;
    const right = mark === '◐'
      ? `${this.fmt(it.paidAmount)}/${this.fmt(it.budgetedAmount)}`
      : this.fmt(it.budgetedAmount);
    return this.row(left, right);
  }
}
