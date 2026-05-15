import { Routes } from '@angular/router';
import { MonthsListComponent } from './list/months-list.component';
import { MonthDetailComponent } from './detail/month-detail.component';

export const MONTHS_ROUTES: Routes = [
  { path: '', component: MonthsListComponent },
  { path: ':id', component: MonthDetailComponent }
];
