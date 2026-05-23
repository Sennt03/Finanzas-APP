import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { RouterModule, RouterOutlet } from '@angular/router';
import { Subscription, switchMap } from 'rxjs';
import { LsResAuth } from '@models/auth.models';
import { LsUser, LsUserDefault } from '@models/user.models';
import { AuthService } from '@services/auth.service';
import { UserService } from '@services/user.service';
import { ThemeService, ThemePref } from '@services/theme.service';
import { sharedImports } from '@shared/shared.imports';
import toastr from '@shared/utils/toastr';

@Component({
  selector: 'app-dashboard',
  imports: [...sharedImports, RouterOutlet, RouterModule],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class Dashboard {
  private authService = inject(AuthService);
  private userService = inject(UserService);
  private themeService = inject(ThemeService);

  maskLoad = signal(false);
  user = signal<LsUser>({ ...LsUserDefault });
  sidebarOpen = signal(false);
  theme = this.themeService.theme;

  private $subUser?: Subscription;

  ngOnInit(): void {
    // En móvil el sidebar arranca cerrado; en desktop siempre se ve por CSS.
    this.sidebarOpen.set(false);

    const auth = this.authService.getAuth() as LsResAuth;
    if (auth?.user) this.user.set(auth.user);

    this.$subUser = this.userService.userProfile.pipe(
      switchMap(() => this.userService.getProfile()),
    ).subscribe(res => {
      this.user.set(res);
    });
  }

  ngOnDestroy(): void {
    this.$subUser?.unsubscribe();
  }

  toggleSidebar() {
    this.sidebarOpen.update(v => !v);
  }

  setTheme(pref: ThemePref) {
    this.themeService.set(pref);
  }

  closeSidebarOnMobile() {
    if (window.innerWidth <= 768) {
      this.sidebarOpen.set(false);
    }
  }

  logout() {
    this.maskLoad.set(true);
    setTimeout(() => {
      toastr.info('Hasta luego!', '');
      this.maskLoad.set(false);
      this.authService.logout();
    }, 300);
  }
}
