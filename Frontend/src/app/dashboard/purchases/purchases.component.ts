import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CreditPurchaseService } from '@services/credit-purchase.service';
import { LsCreditPurchase, MONTH_NAMES } from '@models/finance.models';
import { sharedImports } from '@shared/shared.imports';
import toastr from '@shared/utils/toastr';

interface PurchaseView extends LsCreditPurchase {
  startLabel: string;
  endLabel: string;
  paidCuotas: number;
  totalCuotas: number;
  remainingAmount: number;
  cuotaAmount: number;
}

@Component({
  selector: 'app-purchases',
  imports: [...sharedImports, FormsModule],
  templateUrl: './purchases.component.html',
  styleUrl: './purchases.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class PurchasesComponent {
  private svc = inject(CreditPurchaseService);

  purchases = signal<LsCreditPurchase[]>([]);
  loading = signal(false);

  editingId = signal<string | null>(null);
  editName = signal('');
  editTotal = signal(0);

  enriched = computed<PurchaseView[]>(() =>
    this.purchases().map(p => {
      const sorted = [...p.cuotas].sort((a, b) => (a.year - b.year) || (a.month - b.month));
      const first = sorted[0];
      const last = sorted[sorted.length - 1];
      const paidCuotas = sorted.filter(c => c.isPaid).length;
      const remainingAmount = sorted.filter(c => !c.isPaid).reduce((s, c) => s + c.amount, 0);
      return {
        ...p,
        cuotas: sorted,
        startLabel: first ? `${MONTH_NAMES[first.month - 1]} ${first.year}` : '—',
        endLabel: last ? `${MONTH_NAMES[last.month - 1]} ${last.year}` : '—',
        paidCuotas,
        totalCuotas: sorted.length,
        remainingAmount,
        cuotaAmount: sorted[0]?.amount ?? 0
      };
    })
  );

  diferidos = computed(() => this.enriched().filter(p => p.installments > 1));
  singles = computed(() => this.enriched().filter(p => p.installments === 1));

  ngOnInit() { this.load(); }

  load() {
    this.loading.set(true);
    this.svc.list().subscribe({
      next: (data) => {
        this.purchases.set(data);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        toastr.error('No se pudieron cargar las compras', '');
      }
    });
  }

  startEdit(p: PurchaseView) {
    this.editingId.set(p._id);
    this.editName.set(p.name);
    this.editTotal.set(p.totalAmount);
  }

  cancelEdit() {
    this.editingId.set(null);
  }

  saveEdit(p: PurchaseView) {
    const name = this.editName().trim();
    const total = Number(this.editTotal());
    if (!name || total <= 0) {
      toastr.error('Datos inválidos', '');
      return;
    }
    this.loading.set(true);
    this.svc.update(p._id, { name, totalAmount: total }).subscribe({
      next: () => {
        this.editingId.set(null);
        this.load();
        toastr.success('Compra actualizada', '');
      },
      error: (err) => {
        this.loading.set(false);
        toastr.error(err.error?.message ?? 'Error', '');
      }
    });
  }

  remove(p: PurchaseView) {
    if (!confirm(`¿Eliminar "${p.name}"? Se eliminarán todas sus cuotas (pagadas y pendientes).`)) return;
    this.svc.remove(p._id).subscribe({
      next: () => {
        this.load();
        toastr.info('Eliminada', '');
      },
      error: (err) => toastr.error(err.error?.message ?? 'Error', '')
    });
  }

  cuotaLabel(c: { year: number; month: number }) {
    return `${MONTH_NAMES[c.month - 1]} ${c.year}`;
  }
}
