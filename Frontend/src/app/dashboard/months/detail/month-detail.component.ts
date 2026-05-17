import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { MonthlyStatementService } from '@services/monthly-statement.service';
import { CreditPurchaseService } from '@services/credit-purchase.service';
import { LoanService } from '@services/loan.service';
import {
  CategoryKind, ExtraType, LsLoan, LsMonthlyStatement, LsStatementCategory, LsStatementItem, MONTH_NAMES
} from '@models/finance.models';
import { sharedImports } from '@shared/shared.imports';
import toastr from '@shared/utils/toastr';

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

type TxType = 'expense' | 'income' | 'tdc' | 'diferido';

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

  stmt = signal<LsMonthlyStatement | null>(null);
  loading = signal(false);
  editMode = signal(false);

  draftSalary = signal(0);
  draftCategories = signal<DraftCategory[]>([]);

  // Transaction form
  showTx = signal(false);
  txType = signal<TxType>('expense');
  txName = signal('');
  txAmount = signal<number | null>(null);
  txCategoryName = signal('');
  txDate = signal(this.todayIso());
  txInstallments = signal(2);
  txIsShared = signal(false);
  txBorrowerName = signal('');

  itemDrafts = signal<Record<string, number | null>>({});
  itemSaving = signal<Record<string, boolean>>({});

  // Estado "Agregar item" inline por categoría
  addingForCategory = signal<string | null>(null);
  newItemName = signal('');
  newItemAmount = signal<number | null>(null);
  newItemPaymentMethod = signal<'cash' | 'credit'>('cash');

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

  monthLabel = computed(() => {
    const s = this.stmt();
    return s ? `${MONTH_NAMES[s.month - 1]} ${s.year}` : '';
  });

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
  }

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

  // ----- Gasto real por categoría -----
  categoryPaidSum(cat: LsStatementCategory): number {
    // Incluye credit items cuando ya están pagados (TDC marcada como pagada)
    return (cat.items || []).reduce((s, i) => s + (i.paidAmount || 0), 0);
  }

  categoryBudget(cat: LsStatementCategory): number {
    return (cat.totalAmount && cat.totalAmount > 0) ? cat.totalAmount : this.itemsSum(cat);
  }

  categoryRemainingToPay(cat: LsStatementCategory): number {
    return this.categoryBudget(cat) - this.categoryPaidSum(cat);
  }

  showSpentIndicator(cat: LsStatementCategory): boolean {
    return !cat.isVirtual && cat.kind !== 'savings' && this.itemsSum(cat) > 0;
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
    const remaining = loan.amount - (loan.paidAmount || 0);
    this.loanPayAmount.set(remaining);
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

  openAddItem(cat: LsStatementCategory) {
    if (!cat._id) return;
    this.addingForCategory.set(cat._id);
    this.newItemName.set('');
    this.newItemAmount.set(null);
    this.newItemPaymentMethod.set('cash');
  }

  closeAddItem() {
    this.addingForCategory.set(null);
  }

  toggleNewItemCredit() {
    this.newItemPaymentMethod.update(m => m === 'credit' ? 'cash' : 'credit');
  }

  isAddingTo(cat: LsStatementCategory): boolean {
    return this.addingForCategory() === cat._id;
  }

  submitAddItem(cat: LsStatementCategory) {
    const s = this.stmt();
    if (!s || !cat._id) return;
    const name = this.newItemName().trim();
    const amount = this.newItemAmount() ?? 0;
    if (!name) { toastr.error('Nombre requerido', ''); return; }

    this.loading.set(true);
    this.svc.addItemToCategory(s._id, cat._id, {
      name,
      budgetedAmount: amount,
      paymentMethod: this.newItemPaymentMethod()
    }).subscribe({
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
    this.showTx.set(true);
  }

  closeTx() { this.showTx.set(false); }

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

    if (type === 'expense' || type === 'income') {
      const extraType: ExtraType = type === 'income' ? 'income' : 'expense';
      this.svc.addExtra(s._id, {
        name,
        amount,
        type: extraType,
        categoryName: this.txCategoryName().trim(),
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
      this.purchaseSvc.create({
        name,
        totalAmount: amount,
        purchaseDate: this.txDate(),
        installments,
        isShared: isShared || undefined,
        borrowerName: isShared ? borrowerName : undefined
      }).subscribe({
        next: () => {
          this.closeTx();
          this.load(s._id);
          toastr.success(type === 'diferido' ? 'Diferido registrado' : 'Compra TDC registrada', '');
        },
        error: (err) => {
          this.loading.set(false);
          toastr.error(err.error?.message ?? 'Error', '');
        }
      });
    }
  }

  removeExtra(extraId: string) {
    const s = this.stmt();
    if (!s) return;
    if (!confirm('¿Eliminar este movimiento?')) return;
    this.svc.removeExtra(s._id, extraId).subscribe({
      next: (updated) => {
        this.stmt.set(updated);
        toastr.info('Eliminado', '');
      },
      error: (err) => toastr.error(err.error?.message ?? 'Error', '')
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

  convertExtra(extra: { _id?: string }, newType: 'expense' | 'income' | 'tdc' | 'diferido') {
    if (!extra._id) return;
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
}
