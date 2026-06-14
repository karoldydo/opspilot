import { inject } from '@angular/core';
import { type CanActivateFn, Router } from '@angular/router';
import { AuthStore } from '@app/core/auth/auth.store';

// redirects unauthenticated navigation to /login. reads the shared session state
// synchronously — the app initializer hydrates it before the first navigation runs.
export const authGuard: CanActivateFn = () => {
  const authStore = inject(AuthStore);
  const router = inject(Router);

  return authStore.isAuthenticated() ? true : router.createUrlTree(['/login']);
};
