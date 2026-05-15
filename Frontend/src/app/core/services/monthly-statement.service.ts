import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from 'environments/environment';
import { CategoryKind, LsMonthlyStatement, LsStatementCategory, LsStatementExtra } from '@models/finance.models';

@Injectable({ providedIn: 'root' })
export class MonthlyStatementService {
    private url = `${environment.url_api}/monthly-statements`;
    private http = inject(HttpClient);

    list(): Observable<LsMonthlyStatement[]> {
        return this.http.get<LsMonthlyStatement[]>(this.url);
    }

    get(id: string): Observable<LsMonthlyStatement> {
        return this.http.get<LsMonthlyStatement>(`${this.url}/${id}`);
    }

    create(data: { year: number; month: number; salary?: number }): Observable<LsMonthlyStatement> {
        return this.http.post<LsMonthlyStatement>(this.url, data);
    }

    update(id: string, data: { salary?: number; categories?: LsStatementCategory[] }): Observable<LsMonthlyStatement> {
        return this.http.put<LsMonthlyStatement>(`${this.url}/${id}`, data);
    }

    remove(id: string): Observable<{ _id: string }> {
        return this.http.delete<{ _id: string }>(`${this.url}/${id}`);
    }

    setItemAmount(id: string, payload: { categoryId?: string | null; itemId: string; amount: number; purchaseId?: string | null }): Observable<LsMonthlyStatement> {
        return this.http.post<LsMonthlyStatement>(`${this.url}/${id}/item-amount`, payload);
    }

    addExtra(id: string, payload: Omit<LsStatementExtra, '_id' | 'date'> & { date?: string }): Observable<LsMonthlyStatement> {
        return this.http.post<LsMonthlyStatement>(`${this.url}/${id}/extras`, payload);
    }

    removeExtra(id: string, extraId: string): Observable<LsMonthlyStatement> {
        return this.http.delete<LsMonthlyStatement>(`${this.url}/${id}/extras/${extraId}`);
    }

    toggleCreditGroup(id: string, payload: { paid: boolean }): Observable<LsMonthlyStatement> {
        return this.http.post<LsMonthlyStatement>(`${this.url}/${id}/credit-group`, payload);
    }

    convertMovement(id: string, payload: {
        source: { kind: 'item' | 'extra' | 'purchase'; categoryId?: string; itemId?: string; extraId?: string; purchaseId?: string };
        target: { type: 'expense' | 'income' | 'tdc' | 'diferido'; installments?: number; date?: string; categoryName?: string };
    }): Observable<LsMonthlyStatement> {
        return this.http.post<LsMonthlyStatement>(`${this.url}/${id}/convert`, payload);
    }

    addItemToCategory(id: string, categoryId: string, payload: { name: string; budgetedAmount: number; paymentMethod?: 'cash' | 'credit' }): Observable<LsMonthlyStatement> {
        return this.http.post<LsMonthlyStatement>(`${this.url}/${id}/categories/${categoryId}/items`, payload);
    }

    removeItemFromCategory(id: string, categoryId: string, itemId: string): Observable<LsMonthlyStatement> {
        return this.http.delete<LsMonthlyStatement>(`${this.url}/${id}/categories/${categoryId}/items/${itemId}`);
    }

    updateCategoryMeta(id: string, categoryId: string, payload: { name?: string; kind?: CategoryKind; totalAmount?: number }): Observable<LsMonthlyStatement> {
        return this.http.patch<LsMonthlyStatement>(`${this.url}/${id}/categories/${categoryId}`, payload);
    }
}
