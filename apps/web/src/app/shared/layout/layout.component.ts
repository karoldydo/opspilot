import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthStore } from '@app/core/auth/auth.store';

// sidebar nav entry — absolute path + active-match options (overview matches exact only).
interface NavItem {
  label: string;
  options: { exact: boolean };
  path: string;
}

// app-shell that wraps authed content: persistent 236px terminal sidebar + a content
// router-outlet. session state comes from the root AuthStore; standalone, OnPush.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, RouterLinkActive, RouterOutlet],
  selector: 'app-layout',
  templateUrl: './layout.component.html',
})
export class LayoutComponent {
  private readonly authStore = inject(AuthStore);
  private readonly router = inject(Router);

  protected readonly user = this.authStore.user;

  // 5 real top-level routes; diagnose is reached by drilling into a service, not a nav item.
  protected readonly navItems: readonly NavItem[] = [
    { label: 'overview', options: { exact: true }, path: '/' },
    { label: 'devices', options: { exact: false }, path: '/devices' },
    { label: 'skills', options: { exact: false }, path: '/skills' },
    { label: 'providers', options: { exact: false }, path: '/llm-providers' },
    { label: 'audit', options: { exact: false }, path: '/audit' },
  ];

  async signOut(): Promise<void> {
    await this.authStore.signOut();
    await this.router.navigate(['/login']);
  }
}
