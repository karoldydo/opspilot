import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import { ApplicationConfig, inject, provideAppInitializer, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter } from '@angular/router';
import { appRoutes } from '@app/app.routes';
import { AuthStore } from '@app/core/auth/auth.store';
import { authInterceptor } from '@app/core/interceptors/auth.interceptor';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(appRoutes),
    // same-origin fetch backend + the 401 interceptor. no provideZoneChangeDetection — zoneless.
    provideHttpClient(withFetch(), withInterceptors([authInterceptor])),
    // session source of truth, provided at the app root (not providedIn: 'root', per angular.md).
    AuthStore,
    // hydrate session before the first navigation so a reload while logged in stays authenticated.
    provideAppInitializer(() => inject(AuthStore).loadSession()),
  ],
};
