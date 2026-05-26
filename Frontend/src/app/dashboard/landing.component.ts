import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { MonthlyStatementService } from '@services/monthly-statement.service';
import { sharedImports } from '@shared/shared.imports';

// Punto de entrada de la app: al abrir "/" redirige al detalle del mes actual.
// Si no existe el mes actual usa el más reciente; si no hay ninguno, va al home.
@Component({
  selector: 'app-landing',
  imports: [...sharedImports],
  template: '<app-loading [show]="true"></app-loading>',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class LandingComponent {
  private stmtSvc = inject(MonthlyStatementService);
  private router = inject(Router);

  ngOnInit() {
    this.stmtSvc.list().subscribe({
      next: (data) => {
        const now = new Date();
        const y = now.getFullYear(), m = now.getMonth() + 1;
        const target = data.find(d => d.year === y && d.month === m) ?? data[0];
        if (target) {
          this.router.navigate(['/months', target._id], { replaceUrl: true });
        } else {
          this.router.navigate(['/home'], { replaceUrl: true });
        }
      },
      error: () => this.router.navigate(['/home'], { replaceUrl: true })
    });
  }
}
