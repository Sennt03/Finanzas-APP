import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { catchError, forkJoin, of } from 'rxjs';
import { CreditPurchaseService } from '@services/credit-purchase.service';
import { MonthlyStatementService } from '@services/monthly-statement.service';
import { LsCreditPurchase, LsMonthlyStatement, MONTH_NAMES } from '@models/finance.models';
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

// Una fila = la cuota de una compra que cae en un mes concreto.
interface MonthRow {
  view: PurchaseView;
  name: string;
  isDiferido: boolean;
  cuotaIndex: number;   // posición cronológica de la cuota dentro de la compra (1-based)
  totalCuotas: number;
  amount: number;       // monto de la cuota de ESE mes
  isPaid: boolean;
  isShared: boolean;
  borrowerName: string;
}

// Un bloque por mes: cabecera inline (resumen) + filas de cuotas que se pagan ese mes.
interface MonthBlock {
  year: number;
  month: number;
  label: string;
  total: number;            // suma de cuotas de compras de ese mes (mío + otros)
  mine: number;
  others: number;
  byBorrower: { name: string; amount: number }[];
  realTotal: number | null; // total real a pagar en tarjeta ese mes (incluye items a crédito en categorías)
  rows: MonthRow[];
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
  private stmtSvc = inject(MonthlyStatementService);

  purchases = signal<LsCreditPurchase[]>([]);
  // Total real de tarjeta por mes (`year-month` -> summary.creditCard.total), tomado de cada estado mensual.
  realTotals = signal<Map<string, number>>(new Map());
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

  // Compras agrupadas por mes de pago. Una compra diferida aparece en cada mes que tenga cuota,
  // mostrando la cuota de ese mes. En una compra compartida la cuota es deuda del prestatario.
  months = computed<MonthBlock[]>(() => {
    const realTotals = this.realTotals();
    const map = new Map<string, MonthBlock>();

    for (const p of this.enriched()) {
      const shared = !!p.isShared;
      const borrower = (p.borrowerName ?? '').trim() || 'Otra persona';
      const isDiferido = p.installments > 1;
      const totalCuotas = p.cuotas.length;

      p.cuotas.forEach((c, idx) => {
        const key = `${c.year}-${c.month}`;
        let m = map.get(key);
        if (!m) {
          m = {
            year: c.year,
            month: c.month,
            label: `${MONTH_NAMES[c.month - 1]} ${c.year}`,
            total: 0,
            mine: 0,
            others: 0,
            byBorrower: [],
            realTotal: realTotals.has(key) ? realTotals.get(key)! : null,
            rows: []
          };
          map.set(key, m);
        }
        m.total += c.amount;
        if (shared) {
          m.others += c.amount;
          const b = m.byBorrower.find(x => x.name === borrower);
          if (b) b.amount += c.amount;
          else m.byBorrower.push({ name: borrower, amount: c.amount });
        } else {
          m.mine += c.amount;
        }
        m.rows.push({
          view: p,
          name: p.name,
          isDiferido,
          cuotaIndex: idx + 1,
          totalCuotas,
          amount: c.amount,
          isPaid: c.isPaid,
          isShared: shared,
          borrowerName: shared ? borrower : ''
        });
      });
    }

    const blocks = [...map.values()];
    // Dentro del mes: pendientes primero, luego por monto desc.
    for (const b of blocks) {
      b.rows.sort((x, y) => (Number(x.isPaid) - Number(y.isPaid)) || (y.amount - x.amount));
    }
    // Meses más recientes primero (junio, mayo, ...).
    return blocks.sort((a, b) => (b.year - a.year) || (b.month - a.month));
  });

  ngOnInit() { this.load(); }

  load() {
    this.loading.set(true);
    forkJoin({
      purchases: this.svc.list(),
      statements: this.stmtSvc.list().pipe(catchError(() => of([] as LsMonthlyStatement[])))
    }).subscribe({
      next: ({ purchases, statements }) => {
        this.purchases.set(purchases);
        const rt = new Map<string, number>();
        for (const s of statements) {
          rt.set(`${s.year}-${s.month}`, s.summary?.creditCard?.total ?? 0);
        }
        this.realTotals.set(rt);
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
