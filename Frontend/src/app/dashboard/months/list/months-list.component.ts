import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { MonthlyStatementService } from '@services/monthly-statement.service';
import { LsMonthlyStatement, MONTH_NAMES } from '@models/finance.models';
import { sharedImports } from '@shared/shared.imports';
import toastr from '@shared/utils/toastr';

@Component({
  selector: 'app-months-list',
  imports: [...sharedImports, FormsModule, RouterModule],
  templateUrl: './months-list.component.html',
  styleUrl: './months-list.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class MonthsListComponent {
  private svc = inject(MonthlyStatementService);
  private router = inject(Router);

  months = signal<LsMonthlyStatement[]>([]);
  loading = signal(false);
  showCreate = signal(false);

  now = new Date();
  formYear = signal(this.now.getFullYear());
  formMonth = signal(this.now.getMonth() + 1);
  formSalary = signal<number | null>(null);

  monthNames = MONTH_NAMES;
  yearOptions = computed(() => {
    const current = this.now.getFullYear();
    return [current - 1, current, current + 1];
  });

  ngOnInit(): void {
    this.load();
  }

  load() {
    this.loading.set(true);
    this.svc.list().subscribe({
      next: (data) => {
        this.months.set(data);
        this.loading.set(false);
      },
      error: () => this.loading.set(false)
    });
  }

  monthLabel(m: LsMonthlyStatement) {
    return `${MONTH_NAMES[m.month - 1]} ${m.year}`;
  }

  toggleCreate() {
    this.showCreate.update(v => !v);
  }

  createMonth() {
    const payload: { year: number; month: number; salary?: number } = {
      year: this.formYear(),
      month: this.formMonth()
    };
    const s = this.formSalary();
    if (s !== null && s !== undefined) payload.salary = s;

    this.loading.set(true);
    this.svc.create(payload).subscribe({
      next: (m) => {
        toastr.success('Mes creado!', '');
        this.loading.set(false);
        this.showCreate.set(false);
        this.router.navigate(['/months', m._id]);
      },
      error: (err) => {
        this.loading.set(false);
        toastr.error(err.error?.message ?? 'Error', 'No se pudo crear');
      }
    });
  }

  remove(m: LsMonthlyStatement, ev: Event) {
    ev.stopPropagation();
    if (!confirm(`¿Eliminar ${this.monthLabel(m)}? Se eliminarán también sus movimientos de ahorro.`)) return;
    this.svc.remove(m._id).subscribe({
      next: () => {
        toastr.info('Mes eliminado', '');
        this.load();
      },
      error: (err) => toastr.error(err.error?.message ?? 'Error', '')
    });
  }
}
