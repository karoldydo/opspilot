import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthStore } from '@app/core/auth/auth.store';
import { schemaValidator } from '@app/shared/validators/schema.validator';
import { authRegisterRequestSchema } from '@opspilot/shared';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmCardImports } from '@spartan-ng/helm/card';
import { HlmInput } from '@spartan-ng/helm/input';
import { HlmLabel } from '@spartan-ng/helm/label';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, RouterLink, HlmButton, HlmInput, HlmLabel, ...HlmCardImports],
  selector: 'app-register',
  templateUrl: './register.component.html',
})
export class RegisterComponent {
  private readonly formBuilder = inject(FormBuilder);
  private readonly router = inject(Router);
  private readonly authStore = inject(AuthStore);

  protected readonly errorMessage = signal<null | string>(null);

  protected readonly form = this.formBuilder.nonNullable.group({
    email: ['', [schemaValidator(authRegisterRequestSchema.shape.email)]],
    name: ['', [schemaValidator(authRegisterRequestSchema.shape.name)]],
    password: ['', [schemaValidator(authRegisterRequestSchema.shape.password)]],
  });

  protected readonly submitting = signal(false);

  async submit(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.submitting.set(true);
    this.errorMessage.set(null);

    const result = await this.authStore.signUp(this.form.getRawValue());

    this.submitting.set(false);
    if (result.error) {
      this.errorMessage.set(result.error);
      return;
    }
    await this.router.navigate(['/']);
  }
}
