import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from 'environments/environment';
import { LsBudgetTemplate } from '@models/finance.models';

@Injectable({ providedIn: 'root' })
export class BudgetTemplateService {
    private url = `${environment.url_api}/budget-template`;
    private http = inject(HttpClient);

    get(): Observable<LsBudgetTemplate> {
        return this.http.get<LsBudgetTemplate>(this.url);
    }

    update(data: Partial<LsBudgetTemplate>): Observable<LsBudgetTemplate> {
        return this.http.put<LsBudgetTemplate>(this.url, data);
    }
}
