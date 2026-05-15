import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { forkJoin } from 'rxjs';
import { AccountService } from '@services/account.service';
import { SavingsService } from '@services/savings.service';
import { LsAccount, LsSavingsMovement, SavingsMovementType } from '@models/finance.models';
import { sharedImports } from '@shared/shared.imports';
import toastr from '@shared/utils/toastr';

@Component({
  selector: 'app-accounts',
  imports: [...sharedImports, FormsModule],
  templateUrl: './accounts.component.html',
  styleUrl: './accounts.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class AccountsComponent {
  private accountSvc = inject(AccountService);
  private savingsSvc = inject(SavingsService);

  accounts = signal<LsAccount[]>([]);
  movements = signal<LsSavingsMovement[]>([]);
  loading = signal(false);

  editingId = signal<string | null>(null);
  editName = signal('');
  editInitialBalance = signal(0);

  showMovementForm = signal(false);
  newMovType = signal<SavingsMovementType>('withdrawal');
  newMovAmount = signal<number | null>(null);
  newMovDescription = signal('');

  transactional = computed(() => this.accounts().find(a => a.type === 'transactional'));
  savings = computed(() => this.accounts().find(a => a.type === 'savings'));

  ngOnInit() { this.load(); }

  load() {
    this.loading.set(true);
    forkJoin({
      accounts: this.accountSvc.list(),
      movements: this.savingsSvc.list()
    }).subscribe({
      next: ({ accounts, movements }) => {
        this.accounts.set(accounts);
        this.movements.set(movements);
        this.loading.set(false);
      },
      error: () => this.loading.set(false)
    });
  }

  startEdit(a: LsAccount) {
    this.editingId.set(a._id);
    this.editName.set(a.name);
    this.editInitialBalance.set(a.initialBalance);
  }

  cancelEdit() {
    this.editingId.set(null);
  }

  saveEdit(a: LsAccount) {
    const payload: any = { name: this.editName().trim() };
    if (a.type === 'savings') payload.initialBalance = this.editInitialBalance();

    this.loading.set(true);
    this.accountSvc.update(a._id, payload).subscribe({
      next: () => {
        this.editingId.set(null);
        this.load();
        toastr.success('Cuenta actualizada', '');
      },
      error: (err) => {
        this.loading.set(false);
        toastr.error(err.error?.message ?? 'Error', '');
      }
    });
  }

  toggleMovementForm() {
    this.showMovementForm.update(v => !v);
    if (!this.showMovementForm()) {
      this.newMovAmount.set(null);
      this.newMovDescription.set('');
      this.newMovType.set('withdrawal');
    }
  }

  addMovement() {
    const amt = this.newMovAmount();
    if (amt === null || amt <= 0) {
      toastr.error('Monto inválido', '');
      return;
    }
    this.loading.set(true);
    this.savingsSvc.create({
      type: this.newMovType(),
      amount: amt,
      description: this.newMovDescription().trim()
    }).subscribe({
      next: () => {
        this.toggleMovementForm();
        this.load();
        toastr.success('Movimiento registrado', '');
      },
      error: (err) => {
        this.loading.set(false);
        toastr.error(err.error?.message ?? 'Error', '');
      }
    });
  }

  removeMovement(m: LsSavingsMovement) {
    if (!confirm('¿Eliminar este movimiento?')) return;
    this.savingsSvc.remove(m._id).subscribe({
      next: () => {
        this.load();
        toastr.info('Movimiento eliminado', '');
      },
      error: (err) => toastr.error(err.error?.message ?? 'Error', '')
    });
  }
}
