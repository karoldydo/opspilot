import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthStore } from '@app/core/auth/auth.store';
import { ClickableDirective } from '@app/shared/directives/clickable.directive';
import { schemaValidator } from '@app/shared/validators/schema.validator';
import { authLoginRequestSchema } from '@opspilot/shared';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, RouterLink, ClickableDirective],
  selector: 'app-login',
  templateUrl: './login.component.html',
})
export class LoginComponent {
  private readonly formBuilder = inject(FormBuilder);
  private readonly router = inject(Router);
  private readonly authStore = inject(AuthStore);

  protected readonly errorMessage = signal<null | string>(null);

  protected readonly form = this.formBuilder.nonNullable.group({
    email: ['', [schemaValidator(authLoginRequestSchema.shape.email)]],
    password: ['', [schemaValidator(authLoginRequestSchema.shape.password)]],
  });

  protected readonly submitting = signal(false);

  async submit(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.submitting.set(true);
    this.errorMessage.set(null);

    const result = await this.authStore.signIn(this.form.getRawValue());

    this.submitting.set(false);
    if (result.error) {
      this.errorMessage.set(result.error);
      return;
    }
    await this.router.navigate(['/']);
  }
}
