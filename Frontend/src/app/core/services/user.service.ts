import { HttpClient } from '@angular/common/http';
import { EventEmitter, inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from 'environments/environment';
import { LsUser } from '@models/user.models';

@Injectable({
  providedIn: 'root'
})
export class UserService {
  private url = `${environment.url_api}/user`;
  userProfile = new EventEmitter<boolean>();

  private http = inject(HttpClient);

  getProfile(): Observable<LsUser> {
    return this.http.get<LsUser>(this.url);
  }
}
