import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from 'environments/environment';
import { LsCreditPurchase } from '@models/finance.models';

@Injectable({ providedIn: 'root' })
export class CreditPurchaseService {
    private url = `${environment.url_api}/purchases`;
    private http = inject(HttpClient);

    list(): Observable<LsCreditPurchase[]> {
        return this.http.get<LsCreditPurchase[]>(this.url);
    }

    create(data: {
        name: string;
        totalAmount: number;
        purchaseDate: string;
        installments: number;
    }): Observable<LsCreditPurchase> {
        return this.http.post<LsCreditPurchase>(this.url, data);
    }

    update(id: string, data: { name?: string; totalAmount?: number }): Observable<LsCreditPurchase> {
        return this.http.put<LsCreditPurchase>(`${this.url}/${id}`, data);
    }

    remove(id: string): Observable<{ _id: string }> {
        return this.http.delete<{ _id: string }>(`${this.url}/${id}`);
    }
}
