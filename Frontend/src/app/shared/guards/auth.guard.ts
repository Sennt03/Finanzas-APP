import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { catchError, map, of } from 'rxjs';
import { AuthService } from '@services/auth.service';
import { UserService } from '@services/user.service';

export const authGuard: CanActivateFn = (route, state) => {
  const userService = inject(UserService);
  const authService = inject(AuthService);
  const router = inject(Router);

  return userService.getProfile().pipe(
    map(user => {
      authService.updateAuthUser(user);
      return true;
    }),
    catchError(() => {
      authService.logout();
      router.navigate(['/auth/login']);
      return of(false);
    })
  );
};
