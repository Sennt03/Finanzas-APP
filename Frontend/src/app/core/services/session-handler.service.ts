import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import toastr from '@shared/utils/toastr';
import { AuthService } from './auth.service';
import { NO_TOKEN_HEADER } from './token.service';

// MONITOREA TODAS LAS PETICIONES PARA QUE CUANDO LA SESIÓN HAYA CADUCADO CIERRE LA APP Y MANDE AL LOGIN
export const sessionHandlerInterceptor: HttpInterceptorFn = (req, next) => {
    const authService = inject(AuthService);

    if (req.context.get(NO_TOKEN_HEADER) === true) {
        return next(req);
    }

    return next(req).pipe(
        catchError((error: HttpErrorResponse) => {
            if (error.status === 401) {
                toastr.error('Sesión caducada!', '');
                authService.logout();
            }

            return throwError(() => error);
        })
    );
};
