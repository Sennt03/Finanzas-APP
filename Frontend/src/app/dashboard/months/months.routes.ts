import { Routes } from '@angular/router';
import { MonthsListComponent } from './list/months-list.component';
import { MonthDetailComponent } from './detail/month-detail.component';
import { ActivityLogComponent } from './activity-log/activity-log.component';

export const MONTHS_ROUTES: Routes = [
  { path: '', component: MonthsListComponent },
  { path: ':id', component: MonthDetailComponent },
  { path: ':id/activity', component: ActivityLogComponent }
];
