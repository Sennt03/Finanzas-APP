import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from 'environments/environment';
import { LsLoan } from '@models/finance.models';

export interface LsPayLoanResult {
    loan: LsLoan;
    needsSavingsRepayment: boolean;
}

export interface LsTransferLoanResult {
    originalLoan: LsLoan;
    newLoan: LsLoan;
    savingsMovementId: string;
}

@Injectable({ providedIn: 'root' })
export class LoanService {
    private url = `${environment.url_api}/loans`;
    private http = inject(HttpClient);

    list(): Observable<LsLoan[]> {
        return this.http.get<LsLoan[]>(this.url);
    }

    listForStatement(statementId: string): Observable<LsLoan[]> {
        return this.http.get<LsLoan[]>(`${this.url}/statement/${statementId}`);
    }

    create(payload: { borrowerName: string; amount: number; lentDate: string; statementId: string }): Observable<LsLoan> {
        return this.http.post<LsLoan>(this.url, payload);
    }

    pay(id: string, amount?: number): Observable<LsPayLoanResult> {
        const body = amount !== undefined ? { amount } : {};
        return this.http.patch<LsPayLoanResult>(`${this.url}/${id}/pay`, body);
    }

    transfer(id: string, toStatementId: string): Observable<LsTransferLoanResult> {
        return this.http.patch<LsTransferLoanResult>(`${this.url}/${id}/transfer`, { toStatementId });
    }

    repaySavings(id: string): Observable<LsLoan> {
        return this.http.patch<LsLoan>(`${this.url}/${id}/repay-savings`, {});
    }

    remove(id: string): Observable<{ _id: string }> {
        return this.http.delete<{ _id: string }>(`${this.url}/${id}`);
    }
}
