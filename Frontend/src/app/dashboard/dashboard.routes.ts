import { Routes } from '@angular/router';
import { Dashboard } from './dashboard';
import { HomeComponent } from './home/home.component';

export const DASHBOARD_ROUTES: Routes = [
  {
    path: '',
    component: Dashboard,
    children: [
      {
        path: '',
        component: HomeComponent
      },
      {
        path: '**',
        redirectTo: ''
      }
    ]
  }
];
