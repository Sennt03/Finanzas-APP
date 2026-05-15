import { Routes } from '@angular/router';
import { Dashboard } from './dashboard';
import { HomeComponent } from './home/home.component';
import { AccountsComponent } from './accounts/accounts.component';
import { SettingsComponent } from './settings/settings.component';
import { PurchasesComponent } from './purchases/purchases.component';
import { LoansComponent } from './loans/loans.component';

export const DASHBOARD_ROUTES: Routes = [
  {
    path: '',
    component: Dashboard,
    children: [
      { path: '', component: HomeComponent },
      {
        path: 'months',
        loadChildren: () => import('./months/months.routes').then(m => m.MONTHS_ROUTES)
      },
      { path: 'accounts', component: AccountsComponent },
      { path: 'purchases', component: PurchasesComponent },
      { path: 'loans', component: LoansComponent },
      { path: 'settings', component: SettingsComponent },
      { path: '**', redirectTo: '' }
    ]
  }
];
