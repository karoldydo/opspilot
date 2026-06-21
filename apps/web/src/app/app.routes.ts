import { Route } from '@angular/router';
import { authGuard } from '@app/core/guards/auth.guard';

export const appRoutes: Route[] = [
  {
    loadComponent: () => import('./features/auth/login/login.component').then(({ LoginComponent }) => LoginComponent),
    path: 'login',
  },
  {
    loadComponent: () =>
      import('./features/auth/register/register.component').then(({ RegisterComponent }) => RegisterComponent),
    path: 'register',
  },
  {
    canActivate: [authGuard],
    children: [
      {
        loadComponent: () => import('./features/audit/audit.component').then(({ AuditComponent }) => AuditComponent),
        path: 'audit',
      },
      {
        loadComponent: () =>
          import('./features/devices/devices.component').then(({ DevicesComponent }) => DevicesComponent),
        path: 'devices',
      },
      {
        loadComponent: () =>
          import('./features/llm-providers/llm-providers.component').then(
            ({ LlmProvidersComponent }) => LlmProvidersComponent
          ),
        path: 'llm-providers',
      },
      {
        loadComponent: () =>
          import('./features/skills/skills.component').then(({ SkillsComponent }) => SkillsComponent),
        path: 'skills',
      },
      {
        loadComponent: () => import('./features/home/home.component').then(({ HomeComponent }) => HomeComponent),
        path: '',
      },
    ],
    // authed shell: the layout renders the persistent sidebar + a content outlet for these children.
    loadComponent: () => import('./shared/layout/layout.component').then(({ LayoutComponent }) => LayoutComponent),
    path: '',
  },
  { path: '**', redirectTo: '' },
];
