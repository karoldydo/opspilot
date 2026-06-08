import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { HlmButton } from '@spartan-ng/helm/button';

import { AuthStore } from '../core/stores/auth.store';

// placeholder guarded area — real operational slices come in later roadmap items.
// confirms the guard + session state land an authenticated user here.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HlmButton],
  selector: 'app-home',
  templateUrl: './home.component.html',
})
export class HomeComponent {
  private readonly router = inject(Router);
  private readonly authStore = inject(AuthStore);

  protected readonly user = this.authStore.user;

  async signOut(): Promise<void> {
    await this.authStore.signOut();
    await this.router.navigate(['/login']);
  }
}
