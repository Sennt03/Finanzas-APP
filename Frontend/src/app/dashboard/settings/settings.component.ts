import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { BudgetTemplateService } from '@services/budget-template.service';
import { CategoryKind, LsBudgetTemplate, LsTemplateCategory } from '@models/finance.models';
import { sharedImports } from '@shared/shared.imports';
import toastr from '@shared/utils/toastr';

@Component({
  selector: 'app-settings',
  imports: [...sharedImports, FormsModule],
  templateUrl: './settings.component.html',
  styleUrl: './settings.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class SettingsComponent {
  private svc = inject(BudgetTemplateService);

  template = signal<LsBudgetTemplate | null>(null);
  loading = signal(false);

  draftSalary = signal(0);
  draftCutoffDay = signal(12);
  draftCategories = signal<LsTemplateCategory[]>([]);

  draftTotal = computed(() =>
    this.draftCategories().reduce((acc, c) => {
      const itemsSum = c.items.reduce((a, i) => a + (Number(i.amount) || 0), 0);
      const budget = (c.totalAmount && c.totalAmount > 0) ? Number(c.totalAmount) : itemsSum;
      return acc + budget;
    }, 0)
  );

  draftRemaining = computed(() => this.draftSalary() - this.draftTotal());

  ngOnInit() { this.load(); }

  load() {
    this.loading.set(true);
    this.svc.get().subscribe({
      next: (t) => {
        this.template.set(t);
        this.draftSalary.set(t.defaultSalary);
        this.draftCutoffDay.set(t.cutoffDay || 12);
        this.draftCategories.set(JSON.parse(JSON.stringify(t.categories)));
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        toastr.error('No se pudo cargar', '');
      }
    });
  }

  addCategory() {
    this.draftCategories.update(list => [...list, { name: 'Nueva categoría', kind: 'expense', totalAmount: 0, items: [] }]);
  }

  updateCategoryTotal(idx: number, totalAmount: number) {
    this.draftCategories.update(list => list.map((c, i) => i === idx ? { ...c, totalAmount } : c));
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
      i === catIdx ? { ...c, items: [...c.items, { name: 'Nuevo item', amount: 0 }] } : c
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
      i === catIdx ? { ...c, items: c.items.map((it, j) => j === itemIdx ? { ...it, amount } : it) } : c
    ));
  }

  toggleItemCredit(catIdx: number, itemIdx: number) {
    this.draftCategories.update(list => list.map((c, i) => {
      if (i !== catIdx) return c;
      return {
        ...c,
        items: c.items.map((it, j) => {
          if (j !== itemIdx) return it;
          const next = it.paymentMethod === 'credit' ? 'cash' : 'credit';
          return { ...it, paymentMethod: next };
        })
      };
    }));
  }

  isCreditItem(it: { paymentMethod?: 'cash' | 'credit' }): boolean {
    return it.paymentMethod === 'credit';
  }

  save() {
    if (this.draftTotal() > this.draftSalary()) {
      toastr.error(`Excede el sueldo en ${(this.draftTotal() - this.draftSalary()).toFixed(2)}`, 'Inválido');
      return;
    }
    this.loading.set(true);
    this.svc.update({
      defaultSalary: this.draftSalary(),
      cutoffDay: this.draftCutoffDay(),
      categories: this.draftCategories()
    }).subscribe({
      next: (t) => {
        this.template.set(t);
        this.loading.set(false);
        toastr.success('Configuración guardada', '');
      },
      error: (err) => {
        this.loading.set(false);
        toastr.error(err.error?.message ?? 'Error', '');
      }
    });
  }
}
