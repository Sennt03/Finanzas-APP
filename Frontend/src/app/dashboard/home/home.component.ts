import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { LsResAuth } from '@models/auth.models';
import { LsUser, LsUserDefault } from '@models/user.models';
import { LsCard, LsMonthlyStatement, LsStatementCategory, LsStatementItem, MONTH_NAMES } from '@models/finance.models';
import { AuthService } from '@services/auth.service';
import { MonthlyStatementService } from '@services/monthly-statement.service';
import { CardService } from '@services/card.service';
import { AccountService } from '@services/account.service';
import { sharedImports } from '@shared/shared.imports';
import toastr from '@shared/utils/toastr';

type PendingAction =
  | { kind: 'add'; name: string; amount: number; paymentMethod: 'cash' | 'credit' }
  | { kind: 'pay'; item: LsStatementItem; amount: number };

@Component({
  selector: 'app-home',
  imports: [...sharedImports, FormsModule, RouterModule],
  templateUrl: './home.component.html',
  styleUrl: './home.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class HomeComponent {
  private authService = inject(AuthService);
  private stmtSvc = inject(MonthlyStatementService);
  private cardSvc = inject(CardService);
  private accountSvc = inject(AccountService);

  user = signal<LsUser>({ ...LsUserDefault });
  months = signal<LsMonthlyStatement[]>([]);
  cards = signal<LsCard[]>([]);
  savingsBalance = signal<number | null>(null);
  selectedId = signal<string | null>(null);
  loading = signal(false);

  showDetails = signal(true);

  selected = computed(() => this.months().find(m => m._id === this.selectedId()) ?? null);

  monthLabel = computed(() => {
    const s = this.selected();
    return s ? `${MONTH_NAMES[s.month - 1]} ${s.year}` : '';
  });

  // ----- Categorías -----
  private realCats = computed(() => (this.selected()?.categories ?? []).filter(c => !c.isVirtual));

  flexibleCats = computed(() =>
    [...this.realCats().filter(c => c.flexible && c.kind !== 'savings')].sort((a, b) => this.pct(b) - this.pct(a))
  );

  otherCats = computed(() =>
    [...this.realCats().filter(c => !c.flexible && c.kind !== 'savings')].sort((a, b) => this.pct(b) - this.pct(a))
  );

  savingsCats = computed(() => this.realCats().filter(c => c.kind === 'savings'));

  savingsGoal = computed(() => this.savingsCats().reduce((a, c) => a + (c.categoryBudget ?? c.totalAmount ?? 0), 0));
  savingsDone = computed(() => this.selected()?.summary.savings.monthDeposits ?? 0);

  // ----- Bottom sheet -----
  sheetCatId = signal<string | null>(null);
  sheetCat = computed(() => this.realCats().find(c => c._id === this.sheetCatId()) ?? null);

  itemDrafts = signal<Record<string, number | null>>({});
  itemSaving = signal<Record<string, boolean>>({});

  addingItem = signal(false);
  newItemName = signal('');
  newItemAmount = signal<number | null>(null);

  editingTotal = signal(false);
  editTotalValue = signal<number>(0);

  // ----- Compensación de sobregiro -----
  compTarget = signal<LsStatementCategory | null>(null);
  compOverflow = signal(0);
  compSourceId = signal<string | null>(null);
  private compPending: PendingAction | null = null;

  compSources = computed(() => {
    const target = this.compTarget();
    if (!target) return [] as { cat: LsStatementCategory; free: number }[];
    return this.realCats()
      .filter(c => c._id !== target._id && (c.totalAmount ?? 0) > 0)
      .map(c => ({ cat: c, free: (c.totalAmount ?? 0) - (c.items ?? []).reduce((a, i) => a + (i.budgetedAmount || 0), 0) }))
      .filter(x => x.free > 0.001)
      .sort((a, b) => b.free - a.free);
  });

  ngOnInit(): void {
    const auth = this.authService.getAuth() as LsResAuth;
    if (auth?.user) this.user.set(auth.user);
    this.loadMonths();
    this.cardSvc.list().subscribe({ next: (c) => this.cards.set(c), error: () => {} });
    this.refreshSavings();
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

  loadMonths() {
    this.loading.set(true);
    this.stmtSvc.list().subscribe({
      next: (data) => {
        this.months.set(data);
        const now = new Date();
        const y = now.getFullYear(), m = now.getMonth() + 1;
        const current = data.find(d => d.year === y && d.month === m);
        this.selectedId.set(current?._id ?? data[0]?._id ?? null);
        this.loading.set(false);
      },
      error: () => this.loading.set(false)
    });
  }

  selectMonth(id: string) {
    this.selectedId.set(id);
    this.closeSheet();
  }

  toggleDetails() { this.showDetails.update(v => !v); }

  // ----- Presupuestar a una categoría desde el sueldo o los ingresos extra -----
  allocating = signal(false);
  allocSource = signal<'salary' | 'extra'>('salary');
  allocCatId = signal<string>('__new__'); // '__new__' = crear categoría; si no, un categoryId
  allocNewName = signal('');
  allocAmount = signal<number>(0);
  allocCats = computed(() => {
    const extra = this.allocSource() === 'extra';
    return this.realCats().filter(c => c.kind !== 'savings' && !!c.fromExtraIncome === extra);
  });

  openAllocate(source: 'salary' | 'extra') {
    this.allocSource.set(source);
    const cats = this.allocCats();
    this.allocCatId.set(cats[0]?._id ?? '__new__');
    this.allocNewName.set('');
    const sc = this.selected()?.summary.sinCategoria;
    this.allocAmount.set((source === 'extra' ? sc?.extraAvailable : sc?.salaryAvailable) ?? 0);
    this.allocating.set(true);
  }
  closeAllocate() { this.allocating.set(false); }

  submitAllocate() {
    const id = this.selectedId();
    const sel = this.allocCatId();
    const amt = Number(this.allocAmount());
    if (!id || amt <= 0) { toastr.error('Indica un monto válido', ''); return; }
    const payload: { toCategoryId?: string; newCategoryName?: string; amount: number; source: 'salary' | 'extra' } = { amount: amt, source: this.allocSource() };
    if (sel === '__new__') {
      const name = this.allocNewName().trim();
      if (!name) { toastr.error('Escribe el nombre de la nueva categoría', ''); return; }
      payload.newCategoryName = name;
    } else {
      payload.toCategoryId = sel;
    }
    this.loading.set(true);
    this.stmtSvc.allocate(id, payload).subscribe({
      next: (updated) => {
        this.months.update(list => list.map(m => m._id === updated._id ? updated : m));
        this.loading.set(false);
        this.allocating.set(false);
        toastr.success('Presupuestado', '');
      },
      error: (err) => { this.loading.set(false); toastr.error(err.error?.message ?? 'Error', ''); }
    });
  }

  // Marcar/desmarcar una categoría como "cuenta para PUEDO GASTAR".
  toggleFlexible(cat: LsStatementCategory) {
    const id = this.selectedId();
    if (!id || !cat._id) return;
    this.loading.set(true);
    this.stmtSvc.updateCategoryMeta(id, cat._id, { flexible: !cat.flexible }).subscribe({
      next: (updated) => {
        this.months.update(list => list.map(m => m._id === updated._id ? updated : m));
        this.loading.set(false);
        toastr.success(!cat.flexible ? `"${cat.name}" cuenta para puedo gastar` : `"${cat.name}" ya no cuenta`, '');
      },
      error: (err) => { this.loading.set(false); toastr.error(err.error?.message ?? 'Error', ''); }
    });
  }

  // ----- Cálculos de categoría -----
  pct(cat: LsStatementCategory): number {
    const budget = cat.categoryBudget ?? cat.totalAmount ?? 0;
    if (budget <= 0) return 0;
    return ((cat.spent ?? 0) / budget) * 100;
  }

  status(cat: LsStatementCategory): 'ok' | 'warn' | 'over' {
    const p = this.pct(cat);
    if (p >= 100) return 'over';
    if (p >= 70) return 'warn';
    return 'ok';
  }

  budgetOf(cat: LsStatementCategory): number {
    return cat.categoryBudget ?? cat.totalAmount ?? 0;
  }

  // ----- Bottom sheet -----
  openSheet(cat: LsStatementCategory) {
    if (!cat._id) return;
    this.sheetCatId.set(cat._id);
    this.addingItem.set(false);
    this.editingTotal.set(false);
    this.itemDrafts.set({});
  }

  closeSheet() {
    this.sheetCatId.set(null);
    this.addingItem.set(false);
    this.editingTotal.set(false);
  }

  private refreshStmt(next?: (s: LsMonthlyStatement) => void) {
    const id = this.selectedId();
    if (!id) return;
    this.stmtSvc.get(id).subscribe({
      next: (updated) => {
        this.months.update(list => list.map(m => m._id === updated._id ? updated : m));
        next?.(updated);
      }
    });
  }

  // ----- Items: check / monto inline -----
  draftValue(item: LsStatementItem): number {
    const d = this.itemDrafts()[item._id!];
    return d ?? item.paidAmount;
  }
  isSaving(item: LsStatementItem): boolean { return this.itemSaving()[item._id!] === true; }
  isCredit(item: LsStatementItem): boolean { return item.paymentMethod === 'credit'; }

  onCheck(item: LsStatementItem, cat: LsStatementCategory, ev: Event) {
    const checked = (ev.target as HTMLInputElement).checked;
    this.sendAmount(item, cat, checked ? item.budgetedAmount : 0);
  }

  onAmountInput(item: LsStatementItem, value: number | string) {
    const num = value === '' || value === null ? 0 : Number(value);
    this.itemDrafts.update(d => ({ ...d, [item._id!]: num }));
  }

  commitAmount(item: LsStatementItem, cat: LsStatementCategory) {
    const draft = this.itemDrafts()[item._id!];
    if (draft === undefined || draft === null) return;
    if (Number(draft) === item.paidAmount) { this.clearDraft(item._id!); return; }
    this.sendAmount(item, cat, Number(draft));
  }

  private sendAmount(item: LsStatementItem, cat: LsStatementCategory, amount: number) {
    const id = this.selectedId();
    if (!id || !item._id) return;
    if (amount > item.budgetedAmount) { toastr.error(`No puedes exceder ${item.budgetedAmount}`, ''); this.clearDraft(item._id); return; }
    this.itemSaving.update(d => ({ ...d, [item._id!]: true }));
    this.stmtSvc.setItemAmount(id, { itemId: item._id, amount, categoryId: cat._id }).subscribe({
      next: (updated) => {
        this.months.update(list => list.map(m => m._id === updated._id ? updated : m));
        this.clearDraft(item._id!); this.clearSaving(item._id!);
      },
      error: (err) => { this.clearSaving(item._id!); this.clearDraft(item._id!); toastr.error(err.error?.message ?? 'Error', ''); }
    });
  }

  private clearDraft(itemId: string) { this.itemDrafts.update(d => { const c = { ...d }; delete c[itemId]; return c; }); }
  private clearSaving(itemId: string) { this.itemSaving.update(d => { const c = { ...d }; delete c[itemId]; return c; }); }

  // ----- Agregar item (con chequeo de sobregiro) -----
  openAddItem() {
    this.addingItem.set(true);
    this.newItemName.set('');
    this.newItemAmount.set(null);
  }
  closeAddItem() { this.addingItem.set(false); }

  submitAddItem() {
    const cat = this.sheetCat();
    if (!cat) return;
    const name = this.newItemName().trim();
    const amount = this.newItemAmount() ?? 0;
    if (!name) { toastr.error('Nombre requerido', ''); return; }

    // Sobregiro: si excede el presupuesto (envelope) de la categoría, pedir compensación.
    const budget = this.budgetOf(cat);
    if (budget > 0) {
      const remaining = cat.remaining ?? (budget - (cat.spent ?? 0));
      if (amount > remaining + 0.001) {
        this.startCompensation(cat, amount - remaining, { kind: 'add', name, amount, paymentMethod: 'cash' });
        return;
      }
    }
    this.doAddItem(cat, name, amount);
  }

  private doAddItem(cat: LsStatementCategory, name: string, amount: number) {
    const id = this.selectedId();
    if (!id || !cat._id) return;
    this.loading.set(true);
    this.stmtSvc.addItemToCategory(id, cat._id, { name, budgetedAmount: amount, paymentMethod: 'cash' }).subscribe({
      next: (updated) => {
        this.months.update(list => list.map(m => m._id === updated._id ? updated : m));
        this.addingItem.set(false);
        this.loading.set(false);
        toastr.success('Item agregado', '');
      },
      error: (err) => { this.loading.set(false); toastr.error(err.error?.message ?? 'Error', ''); }
    });
  }

  // ----- Editar total de la categoría -----
  openEditTotal() {
    const cat = this.sheetCat();
    if (!cat) return;
    this.editTotalValue.set(cat.totalAmount ?? 0);
    this.editingTotal.set(true);
  }
  closeEditTotal() { this.editingTotal.set(false); }

  saveTotal() {
    const cat = this.sheetCat();
    const id = this.selectedId();
    if (!cat || !cat._id || !id) return;
    this.loading.set(true);
    this.stmtSvc.updateCategoryMeta(id, cat._id, { totalAmount: Number(this.editTotalValue()) || 0 }).subscribe({
      next: (updated) => {
        this.months.update(list => list.map(m => m._id === updated._id ? updated : m));
        this.editingTotal.set(false);
        this.loading.set(false);
        toastr.success('Presupuesto actualizado', '');
      },
      error: (err) => { this.loading.set(false); toastr.error(err.error?.message ?? 'Error', ''); }
    });
  }

  // ----- Compensación de sobregiro -----
  private startCompensation(target: LsStatementCategory, overflow: number, pending: PendingAction) {
    this.compTarget.set(target);
    this.compOverflow.set(Math.round(overflow * 100) / 100);
    this.compSourceId.set(this.compSources()[0]?.cat._id ?? null);
    this.compPending = pending;
  }

  cancelCompensation() {
    this.compTarget.set(null);
    this.compPending = null;
    this.compSourceId.set(null);
  }

  confirmCompensation() {
    const target = this.compTarget();
    const sourceId = this.compSourceId();
    const id = this.selectedId();
    if (!target || !target._id || !sourceId || !id) { toastr.error('Elige una categoría para compensar', ''); return; }
    const amount = this.compOverflow();
    this.loading.set(true);
    this.stmtSvc.compensate(id, { fromCategoryId: sourceId, toCategoryId: target._id, amount }).subscribe({
      next: (updated) => {
        this.months.update(list => list.map(m => m._id === updated._id ? updated : m));
        this.loading.set(false);
        const pending = this.compPending;
        const freshCat = updated.categories.find(c => c._id === target._id) ?? target;
        this.cancelCompensation();
        toastr.success('Presupuesto compensado', '');
        if (pending?.kind === 'add') this.doAddItem(freshCat, pending.name, pending.amount);
      },
      error: (err) => { this.loading.set(false); toastr.error(err.error?.message ?? 'Error', ''); }
    });
  }
}
