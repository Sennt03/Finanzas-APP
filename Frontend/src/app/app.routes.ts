import { Routes } from '@angular/router';
import { authGuard } from '@shared/guards/auth.guard';
import { noAuthGuard } from '@shared/guards/no-auth.guard';

export const routes: Routes = [
  {
    path: 'auth',
    loadChildren: () => import('./auth/auth.routes').then(m => m.AUTH_ROUTES),
    canActivate: [noAuthGuard]
  },
  {
    path: '',
    loadChildren: () => import('./dashboard/dashboard.routes').then(m => m.DASHBOARD_ROUTES),
    canActivate: [authGuard]
  },
  {
    path: '**',
    redirectTo: '/auth'
  }
];
