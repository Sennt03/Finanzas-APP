import { HttpContext, HttpContextToken, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { AuthService } from './auth.service';

export const NO_TOKEN_HEADER = new HttpContextToken<boolean>(() => false);

export function noInterceptToken() {
    return new HttpContext().set(NO_TOKEN_HEADER, true);
}

export const tokenInterceptor: HttpInterceptorFn = (req, next) => {
    const authService = inject(AuthService);
    const token = authService.getToken();

    if (req.context.get(NO_TOKEN_HEADER) === true) {
        return next(req);
    }

    if (token) {
        const clonedReq = req.clone({
            setHeaders: {
                Authorization: `Bearer ${token}`,
            },
        });
        return next(clonedReq);
    }

    return next(req);
};
