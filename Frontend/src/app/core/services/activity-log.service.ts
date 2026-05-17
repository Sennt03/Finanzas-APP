import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from 'environments/environment';
import { LsActivityLog } from '@models/finance.models';

@Injectable({ providedIn: 'root' })
export class ActivityLogService {
    private url = `${environment.url_api}/activity-logs`;
    private http = inject(HttpClient);

    listByMonth(year: number, month: number): Observable<LsActivityLog[]> {
        return this.http.get<LsActivityLog[]>(this.url, { params: { year, month } });
    }

    delete(id: string): Observable<{ _id: string }> {
        return this.http.delete<{ _id: string }>(`${this.url}/${id}`);
    }
}
