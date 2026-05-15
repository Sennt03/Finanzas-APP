import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { LsResAuth } from '@models/auth.models';
import { LsUser, LsUserDefault } from '@models/user.models';
import { AuthService } from '@services/auth.service';

@Component({
  selector: 'app-home',
  imports: [],
  templateUrl: './home.component.html',
  styleUrl: './home.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class HomeComponent {
  private authService = inject(AuthService);

  user = signal<LsUser>({ ...LsUserDefault });

  ngOnInit(): void {
    const auth = this.authService.getAuth() as LsResAuth;
    if (auth?.user) this.user.set(auth.user);
  }
}
