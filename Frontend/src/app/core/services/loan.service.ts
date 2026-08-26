import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from 'environments/environment';
import { LsLoan, LoanTransferType } from '@models/finance.models';

export interface LsPayLoanResult {
    loan: LsLoan;
    needsSavingsRepayment: boolean;
}

export interface LsTransferLoanResult {
    originalLoan: LsLoan;
    newLoan: LsLoan;
    savingsMovementId: string;
}

export interface LsRevertTransferResult {
    loan: LsLoan;
    removedLoanId: string;
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

    revertPayment(id: string): Observable<LsLoan> {
        return this.http.patch<LsLoan>(`${this.url}/${id}/revert-payment`, {});
    }

    transfer(id: string, toStatementId: string, mode: LoanTransferType): Observable<LsTransferLoanResult> {
        return this.http.patch<LsTransferLoanResult>(`${this.url}/${id}/transfer`, { toStatementId, mode });
    }

    revertTransfer(id: string): Observable<LsRevertTransferResult> {
        return this.http.patch<LsRevertTransferResult>(`${this.url}/${id}/revert-transfer`, {});
    }

    repaySavings(id: string): Observable<LsLoan> {
        return this.http.patch<LsLoan>(`${this.url}/${id}/repay-savings`, {});
    }

    remove(id: string): Observable<{ _id: string }> {
        return this.http.delete<{ _id: string }>(`${this.url}/${id}`);
    }
}
