import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Router } from '@angular/router';
import { Observable } from 'rxjs';
import { environment } from 'environments/environment';
import { LsFields, LsisAvaible, LsLogin, LsRegister, LsResAuth } from '@models/auth.models';
import { LsUser } from '@models/user.models';
import { noInterceptToken } from './token.service';

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private url = `${environment.url_api}/auth`;
  private noToken = { context: noInterceptToken() };

  private http = inject(HttpClient);
  private router = inject(Router);

  validateAvaible(value: string, field: LsFields): Observable<LsisAvaible> {
    return this.http.post<LsisAvaible>(`${this.url}/validate/${field}`, { value }, this.noToken);
  }

  login(data: LsLogin): Observable<LsResAuth> {
    return this.http.post<LsResAuth>(`${this.url}/login`, data, this.noToken);
  }

  register(data: LsRegister): Observable<LsResAuth> {
    return this.http.post<LsResAuth>(`${this.url}/register`, data, this.noToken);
  }

  saveAuth(data: LsResAuth) {
    localStorage.setItem('auth', JSON.stringify(data));
  }

  updateAuthUser(user: LsUser) {
    try {
      const auth = JSON.parse(localStorage.getItem('auth') as string);
      auth.user = user;
      localStorage.setItem('auth', JSON.stringify(auth));
    } catch {
      this.logout();
    }
  }

  getAuth(): LsResAuth | boolean {
    try {
      return JSON.parse(localStorage.getItem('auth') as string);
    } catch {
      this.logout();
      return false;
    }
  }

  getToken(): string {
    const auth: any = this.getAuth();
    return auth?.token;
  }

  loggedIn(): boolean {
    const auth = this.getAuth() as LsResAuth;
    return auth ? true : false;
  }

  logout() {
    localStorage.removeItem('auth');
    this.router.navigate(['/auth/login']);
  }
}
