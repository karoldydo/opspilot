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
    loadComponent: () => import('./features/audit/audit.component').then(({ AuditComponent }) => AuditComponent),
    path: 'audit',
  },
  {
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/devices/devices.component').then(({ DevicesComponent }) => DevicesComponent),
    path: 'devices',
  },
  {
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/llm-providers/llm-providers.component').then(
        ({ LlmProvidersComponent }) => LlmProvidersComponent
      ),
    path: 'llm-providers',
  },
  {
    canActivate: [authGuard],
    loadComponent: () => import('./features/skills/skills.component').then(({ SkillsComponent }) => SkillsComponent),
    path: 'skills',
  },
  {
    canActivate: [authGuard],
    loadComponent: () => import('./home/home.component').then(({ HomeComponent }) => HomeComponent),
    path: '',
  },
  { path: '**', redirectTo: '' },
];
