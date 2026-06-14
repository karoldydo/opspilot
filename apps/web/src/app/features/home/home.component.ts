import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AuthStore } from '@app/core/auth/auth.store';
import { HlmButton } from '@spartan-ng/helm/button';

// placeholder guarded area — real operational slices come in later roadmap items.
// confirms the guard + session state land an authenticated user here.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HlmButton, RouterLink],
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
