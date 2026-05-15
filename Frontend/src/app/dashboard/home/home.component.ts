import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { LsResAuth } from '@models/auth.models';
import { LsUser, LsUserDefault } from '@models/user.models';
import { LsMonthlyStatement, MONTH_NAMES } from '@models/finance.models';
import { AuthService } from '@services/auth.service';
import { MonthlyStatementService } from '@services/monthly-statement.service';
import { sharedImports } from '@shared/shared.imports';

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

  user = signal<LsUser>({ ...LsUserDefault });
  months = signal<LsMonthlyStatement[]>([]);
  selectedId = signal<string | null>(null);
  loading = signal(false);

  selected = computed(() => this.months().find(m => m._id === this.selectedId()) ?? null);

  monthLabel = computed(() => {
    const s = this.selected();
    return s ? `${MONTH_NAMES[s.month - 1]} ${s.year}` : '';
  });

  recentMovements = computed(() => {
    const s = this.selected();
    if (!s) return [];
    const items: { name: string; amount: number; type: 'income' | 'expense' | 'paid' | 'credit'; date: string }[] = [];
    for (const cat of s.categories) {
      if (cat.isVirtual) continue;
      for (const it of cat.items) {
        if (it.paidAmount > 0) {
          items.push({
            name: it.name,
            amount: it.paidAmount,
            type: cat.kind === 'savings' ? 'paid' : 'paid',
            date: it.paidAt ?? new Date().toISOString()
          });
        }
      }
    }
    for (const e of s.extras) {
      items.push({
        name: e.name,
        amount: e.amount,
        type: e.type,
        date: e.date
      });
    }
    return items
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .slice(0, 8);
  });

  ngOnInit(): void {
    const auth = this.authService.getAuth() as LsResAuth;
    if (auth?.user) this.user.set(auth.user);
    this.loadMonths();
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
  }
}
