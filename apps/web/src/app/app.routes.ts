import { Route } from '@angular/router';

import { authGuard } from './core/guards/auth.guard';

export const appRoutes: Route[] = [
  {
    loadComponent: () => import('./auth/login/login.component').then(({ LoginComponent }) => LoginComponent),
    path: 'login',
  },
  {
    loadComponent: () =>
      import('./auth/register/register.component').then(({ RegisterComponent }) => RegisterComponent),
    path: 'register',
  },
  {
    canActivate: [authGuard],
    loadComponent: () => import('./home/home.component').then(({ HomeComponent }) => HomeComponent),
    path: '',
  },
  { path: '**', redirectTo: '' },
];
