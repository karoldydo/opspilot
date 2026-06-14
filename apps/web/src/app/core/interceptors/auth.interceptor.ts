import { HttpErrorResponse, type HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { AuthStore } from '@app/core/auth/auth.store';
import { catchError, throwError } from 'rxjs';

// on any 401, clear local session state and redirect to /login so an expired
// session never leaves the ui half-authenticated. all other errors pass through.
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const authStore = inject(AuthStore);
  const router = inject(Router);

  return next(req).pipe(
    catchError((error: unknown) => {
      if (error instanceof HttpErrorResponse && error.status === 401) {
        authStore.clear();
        void router.navigate(['/login']);
      }
      return throwError(() => error);
    })
  );
};
