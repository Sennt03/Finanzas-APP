import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from 'environments/environment';
import { LsCreditPurchase, LsLoan } from '@models/finance.models';

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
        isShared?: boolean;
        borrowerName?: string;
        cardId?: string | null;
        categoryName?: string;
    }): Observable<LsCreditPurchase> {
        return this.http.post<LsCreditPurchase>(this.url, data);
    }

    update(id: string, data: { name?: string; totalAmount?: number; cardId?: string | null; categoryName?: string }): Observable<LsCreditPurchase> {
        return this.http.put<LsCreditPurchase>(`${this.url}/${id}`, data);
    }

    payBorrowerCuota(purchaseId: string, cuotaId: string, amount: number): Observable<LsCreditPurchase> {
        return this.http.patch<LsCreditPurchase>(
            `${this.url}/${purchaseId}/cuota/${cuotaId}/pay-borrower`,
            { amount }
        );
    }

    convertCuotaToLoan(purchaseId: string, cuotaId: string): Observable<{ purchase: LsCreditPurchase; loan: LsLoan }> {
        return this.http.patch<{ purchase: LsCreditPurchase; loan: LsLoan }>(
            `${this.url}/${purchaseId}/cuota/${cuotaId}/convert-to-loan`,
            {}
        );
    }

    remove(id: string): Observable<{ _id: string }> {
        return this.http.delete<{ _id: string }>(`${this.url}/${id}`);
    }
}
