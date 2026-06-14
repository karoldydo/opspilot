import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import { ApplicationConfig, inject, provideAppInitializer, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter } from '@angular/router';
import { appRoutes } from '@app/app.routes';
import { authInterceptor } from '@app/core/interceptors/auth.interceptor';

import { AuthStore } from './core/stores/auth.store';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(appRoutes),
    // same-origin fetch backend + the 401 interceptor. no provideZoneChangeDetection — zoneless.
    provideHttpClient(withFetch(), withInterceptors([authInterceptor])),
    // session source of truth shared by guard, interceptor, and the auth screens —
    // provided explicitly at the app root, not providedIn: 'root' (angular.md).
    AuthStore,
    // hydrate the session before the first navigation so a reload while logged in
    // doesn't bounce through the guard to /login.
    provideAppInitializer(() => inject(AuthStore).loadSession()),
  ],
};
