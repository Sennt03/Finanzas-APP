import { HttpClient } from '@angular/common/http';
import { inject, Injectable, signal } from '@angular/core';
import { Observable, tap } from 'rxjs';
import { environment } from 'environments/environment';
import { LsAccount } from '@models/finance.models';

@Injectable({ providedIn: 'root' })
export class AccountService {
    private url = `${environment.url_api}/accounts`;
    private http = inject(HttpClient);

    accounts = signal<LsAccount[]>([]);

    list(): Observable<LsAccount[]> {
        return this.http.get<LsAccount[]>(this.url).pipe(
            tap(data => this.accounts.set(data))
        );
    }

    update(id: string, data: Partial<Pick<LsAccount, 'name' | 'initialBalance'>>): Observable<LsAccount> {
        return this.http.patch<LsAccount>(`${this.url}/${id}`, data).pipe(
            tap(updated => {
                this.accounts.update(list => list.map(a => a._id === id ? updated : a));
            })
        );
    }
}
