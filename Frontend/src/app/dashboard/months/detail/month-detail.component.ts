import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { MonthlyStatementService } from '@services/monthly-statement.service';
import { CreditPurchaseService } from '@services/credit-purchase.service';
import {
  CategoryKind, ExtraType, LsMonthlyStatement, LsStatementCategory, LsStatementItem, MONTH_NAMES
} from '@models/finance.models';
import { sharedImports } from '@shared/shared.imports';
import toastr from '@shared/utils/toastr';

interface DraftItem {
  _id?: string;
  name: string;
  budgetedAmount: number;
}
interface DraftCategory {
  _id?: string;
  name: string;
  kind: CategoryKind;
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

  itemDrafts = signal<Record<string, number | null>>({});
  itemSaving = signal<Record<string, boolean>>({});

  monthLabel = computed(() => {
    const s = this.stmt();
    return s ? `${MONTH_NAMES[s.month - 1]} ${s.year}` : '';
  });

  draftTotalBudgeted = computed(() =>
    this.draftCategories().reduce((acc, c) =>
      acc + c.items.reduce((a, i) => a + (Number(i.budgetedAmount) || 0), 0), 0)
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
      },
      error: () => {
        this.loading.set(false);
        toastr.error('No se pudo cargar', '');
        this.router.navigate(['/months']);
      }
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
        items: c.items.map(i => ({ _id: i._id, name: i.name, budgetedAmount: i.budgetedAmount }))
      }))
    );
    this.editMode.set(true);
  }

  cancelEdit() { this.editMode.set(false); }

  addCategory() {
    this.draftCategories.update(list => [...list, { name: 'Nueva categoría', kind: 'expense', items: [] }]);
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
      i === catIdx ? { ...c, items: [...c.items, { name: 'Nuevo item', budgetedAmount: 0 }] } : c
    ));
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
      this.purchaseSvc.create({
        name,
        totalAmount: amount,
        purchaseDate: this.txDate(),
        installments
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
