import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from 'environments/environment';
import { LsSavingsMovement, SavingsMovementType } from '@models/finance.models';

@Injectable({ providedIn: 'root' })
export class SavingsService {
    private url = `${environment.url_api}/savings-movements`;
    private http = inject(HttpClient);

    list(): Observable<LsSavingsMovement[]> {
        return this.http.get<LsSavingsMovement[]>(this.url);
    }

    create(data: {
        type: SavingsMovementType;
        amount: number;
        description?: string;
        monthlyStatementId?: string | null;
        date?: string;
    }): Observable<LsSavingsMovement> {
        return this.http.post<LsSavingsMovement>(this.url, data);
    }

    remove(id: string): Observable<{ _id: string }> {
        return this.http.delete<{ _id: string }>(`${this.url}/${id}`);
    }
}
