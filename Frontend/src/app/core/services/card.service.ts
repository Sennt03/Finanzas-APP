import { HttpClient } from '@angular/common/http';
import { inject, Injectable, signal } from '@angular/core';
import { Observable, tap } from 'rxjs';
import { environment } from 'environments/environment';
import { LsCard } from '@models/finance.models';

@Injectable({ providedIn: 'root' })
export class CardService {
    private url = `${environment.url_api}/cards`;
    private http = inject(HttpClient);

    cards = signal<LsCard[]>([]);

    list(): Observable<LsCard[]> {
        return this.http.get<LsCard[]>(this.url).pipe(
            tap(data => this.cards.set(data))
        );
    }

    create(data: Partial<LsCard>): Observable<LsCard> {
        return this.http.post<LsCard>(this.url, data);
    }

    update(id: string, data: Partial<LsCard>): Observable<LsCard> {
        return this.http.put<LsCard>(`${this.url}/${id}`, data);
    }

    remove(id: string): Observable<{ _id: string }> {
        return this.http.delete<{ _id: string }>(`${this.url}/${id}`);
    }
}
