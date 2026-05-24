import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { ActivityLogService } from '@services/activity-log.service';
import { LsActivityLog, MONTH_NAMES } from '@models/finance.models';
import { sharedImports } from '@shared/shared.imports';
import { DatePipe } from '@angular/common';
import toastr from '@shared/utils/toastr';

interface LogDay {
    dateLabel: string;
    entries: LsActivityLog[];
}

@Component({
    selector: 'app-activity-log',
    imports: [RouterModule, ...sharedImports, DatePipe],
    templateUrl: './activity-log.component.html',
    styleUrl: './activity-log.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class ActivityLogComponent {
    private route = inject(ActivatedRoute);
    private svc = inject(ActivityLogService);

    readonly year = signal(0);
    readonly month = signal(0);
    readonly statementId = signal('');
    readonly loading = signal(true);
    readonly logs = signal<LsActivityLog[]>([]);
    readonly deleting = signal<Set<string>>(new Set());

    readonly monthLabel = computed(() => {
        const m = this.month();
        const y = this.year();
        return m > 0 && y > 0 ? `${MONTH_NAMES[m - 1]} ${y}` : '';
    });

    readonly days = computed<LogDay[]>(() => {
        const grouped = new Map<string, LsActivityLog[]>();
        for (const entry of this.logs()) {
            const d = new Date(entry.createdAt);
            const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
            if (!grouped.has(key)) grouped.set(key, []);
            grouped.get(key)!.push(entry);
        }
        return Array.from(grouped.entries())
            .sort(([a], [b]) => b.localeCompare(a))
            .map(([key, entries]) => ({
                dateLabel: this.formatDayLabel(key),
                entries
            }));
    });

    constructor() {
        const params = this.route.snapshot.params;
        const qp = this.route.snapshot.queryParams;
        this.statementId.set(params['id']);
        this.year.set(Number(qp['year']));
        this.month.set(Number(qp['month']));

        this.svc.listByMonth(this.year(), this.month()).subscribe({
            next: data => { this.logs.set(data); this.loading.set(false); },
            error: () => this.loading.set(false)
        });
    }

    isDeleting(id: string): boolean {
        return this.deleting().has(id);
    }

    deleteEntry(entry: LsActivityLog) {
        if (!entry.deletable || this.isDeleting(entry._id)) return;
        if (!confirm('¿Deshacer este movimiento? Se revertirá el cambio en la cuenta.')) return;

        this.deleting.update(s => new Set([...s, entry._id]));
        this.svc.delete(entry._id).subscribe({
            next: () => {
                this.logs.update(list => list.filter(e => e._id !== entry._id));
                this.deleting.update(s => { const n = new Set(s); n.delete(entry._id); return n; });
                toastr.success('Movimiento deshecho', '');
            },
            error: (err) => {
                this.deleting.update(s => { const n = new Set(s); n.delete(entry._id); return n; });
                toastr.error(err.error?.message ?? 'Error al deshacer', '');
            }
        });
    }

    iconFor(action: string): string {
        const map: Record<string, string> = {
            item_paid: 'bx-check-circle',
            item_partial: 'bx-radio-circle-marked',
            item_unpaid: 'bx-x-circle',
            item_added: 'bx-plus-circle',
            item_deleted: 'bx-trash',
            item_converted: 'bx-transfer-alt',
            extra_added: 'bx-receipt',
            extra_deleted: 'bx-trash',
            extra_converted: 'bx-transfer-alt',
            tdc_created: 'bx-credit-card',
            diferido_created: 'bx-list-plus',
            credit_group_paid: 'bx-credit-card',
            credit_group_unpaid: 'bx-credit-card',
            budget_updated: 'bx-edit',
            loan_created: 'bx-dollar',
            loan_paid: 'bx-check-circle',
            loan_partial: 'bx-radio-circle-marked',
            loan_transferred: 'bx-right-arrow-alt',
            loan_transfer_reverted: 'bx-undo',
            loan_repaid_savings: 'bx-piggy-bank',
            loan_deleted: 'bx-trash',
            borrower_paid: 'bx-dollar',
            cuota_to_loan: 'bx-transfer-alt'
        };
        return map[action] ?? 'bx-dots-horizontal-rounded';
    }

    colorFor(action: string): string {
        if (['item_paid', 'loan_paid', 'credit_group_paid'].includes(action)) return 'success';
        if (['item_partial', 'loan_partial'].includes(action)) return 'warning';
        if (['item_deleted', 'extra_deleted', 'loan_deleted'].includes(action)) return 'danger';
        if (['item_unpaid', 'credit_group_unpaid', 'loan_transfer_reverted'].includes(action)) return 'muted';
        if (['loan_created', 'loan_transferred', 'loan_repaid_savings', 'cuota_to_loan'].includes(action)) return 'loan';
        if (['tdc_created', 'diferido_created', 'borrower_paid'].includes(action)) return 'credit';
        if (['extra_added', 'item_added'].includes(action)) return 'accent';
        return 'soft';
    }

    private formatDayLabel(key: string): string {
        const [y, m, d] = key.split('-').map(Number);
        const date = new Date(y, m - 1, d);
        return date.toLocaleDateString('es-EC', { weekday: 'long', day: 'numeric', month: 'long' });
    }
}
