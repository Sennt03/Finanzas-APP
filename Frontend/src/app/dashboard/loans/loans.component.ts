import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { forkJoin } from 'rxjs';
import { LoanService } from '@services/loan.service';
import { MonthlyStatementService } from '@services/monthly-statement.service';
import { LsLoan, LsMonthlyStatement, MONTH_NAMES } from '@models/finance.models';
import { sharedImports } from '@shared/shared.imports';
import toastr from '@shared/utils/toastr';

@Component({
  selector: 'app-loans',
  imports: [...sharedImports, FormsModule],
  templateUrl: './loans.component.html',
  styleUrl: './loans.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class LoansComponent {
  private loanSvc = inject(LoanService);
  private stmtSvc = inject(MonthlyStatementService);

  loans = signal<LsLoan[]>([]);
  statements = signal<Pick<LsMonthlyStatement, '_id' | 'year' | 'month'>[]>([]);
  loading = signal(false);

  transferingLoanId = signal<string | null>(null);
  transferTargetId = signal('');

  payingLoanId = signal<string | null>(null);
  loanPayAmount = signal<number | null>(null);

  pending = computed(() => this.loans().filter(l => l.status === 'pending'));
  paid = computed(() => this.loans().filter(l => l.status === 'paid'));
  transferred = computed(() => this.loans().filter(l => l.status === 'transferred'));

  needsSavingsRepayment = computed(() =>
    this.loans().filter(l => l.status === 'paid' && l.fromSavings && !l.paidBackToSavings)
  );

  monthNames = MONTH_NAMES;

  ngOnInit() { this.load(); }

  load() {
    this.loading.set(true);
    this.loanSvc.list().subscribe({
      next: (loans) => {
        this.loans.set(loans);
        this.loading.set(false);
      },
      error: () => this.loading.set(false)
    });
  }

  stmtLabel(loan: LsLoan, which: 'origin' | 'current'): string {
    const ref = which === 'origin' ? loan.originStatement : loan.currentStatement;
    if (!ref) return '—';
    return `${MONTH_NAMES[ref.month - 1]} ${ref.year}`;
  }

  openPayLoan(loan: LsLoan) {
    this.payingLoanId.set(loan._id);
    this.loanPayAmount.set(this.loanRemaining(loan));
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
        this.loans.update(list => list.map(l => l._id === updated._id ? updated : l));
        this.closePayLoan();
        this.loading.set(false);
        if (needsSavingsRepayment) {
          toastr.info(`Cobrado. Esta plata vino de ahorros — recuerda devolver $${loan.amount} a Produbanco.`, '');
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

  openTransfer(loan: LsLoan) {
    this.transferingLoanId.set(loan._id);
    this.transferTargetId.set('');
    if (!this.statements().length) {
      this.stmtSvc.list().subscribe({
        next: (stmts) => this.statements.set(stmts.map(s => ({ _id: s._id, year: s.year, month: s.month }))),
        error: () => toastr.error('No se pudieron cargar los meses', '')
      });
    }
  }

  closeTransfer() {
    this.transferingLoanId.set(null);
    this.transferTargetId.set('');
  }

  availableTargets(loan: LsLoan): Pick<LsMonthlyStatement, '_id' | 'year' | 'month'>[] {
    const currentKey = loan.currentStatement
      ? loan.currentStatement.year * 100 + loan.currentStatement.month
      : 0;
    return this.statements().filter(s => s.year * 100 + s.month > currentKey);
  }

  submitTransfer(loan: LsLoan) {
    const toId = this.transferTargetId();
    if (!toId) { toastr.error('Selecciona el mes destino', ''); return; }
    this.loading.set(true);
    this.loanSvc.transfer(loan._id, toId).subscribe({
      next: ({ originalLoan, newLoan }) => {
        this.loans.update(list =>
          list.map(l => l._id === originalLoan._id ? originalLoan : l).concat(newLoan)
        );
        this.closeTransfer();
        this.loading.set(false);
        toastr.success('Préstamo transferido. Se hizo un retiro de ahorros para cubrir el mes actual.', '');
      },
      error: (err) => {
        this.loading.set(false);
        toastr.error(err.error?.message ?? 'Error', '');
      }
    });
  }

  repaySavings(loan: LsLoan) {
    if (!confirm(`¿Devolver $${loan.amount} a la cuenta de ahorros por el préstamo a ${loan.borrowerName}?`)) return;
    this.loading.set(true);
    this.loanSvc.repaySavings(loan._id).subscribe({
      next: (updated) => {
        this.loans.update(list => list.map(l => l._id === updated._id ? updated : l));
        this.loading.set(false);
        toastr.success('Devuelto a ahorros correctamente', '');
      },
      error: (err) => {
        this.loading.set(false);
        toastr.error(err.error?.message ?? 'Error', '');
      }
    });
  }

  deleteLoan(loan: LsLoan) {
    if (!confirm(`¿Eliminar el préstamo a ${loan.borrowerName}?`)) return;
    this.loading.set(true);
    this.loanSvc.remove(loan._id).subscribe({
      next: () => {
        this.loans.update(list => list.filter(l => l._id !== loan._id));
        this.loading.set(false);
        toastr.info('Préstamo eliminado', '');
      },
      error: (err) => {
        this.loading.set(false);
        toastr.error(err.error?.message ?? 'Error', '');
      }
    });
  }

  isTransfering(loan: LsLoan): boolean {
    return this.transferingLoanId() === loan._id;
  }
}
