import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { credentialCreateRequestSchema, type Device, deviceCreateRequestSchema } from '@opspilot/shared';
import { BrnDialogRef, injectBrnDialogContext } from '@spartan-ng/brain/dialog';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmDialogDescription, HlmDialogFooter, HlmDialogHeader, HlmDialogTitle } from '@spartan-ng/helm/dialog';
import { HlmInput } from '@spartan-ng/helm/input';
import { HlmLabel } from '@spartan-ng/helm/label';
import { HlmSelectImports } from '@spartan-ng/helm/select';

import { type DeviceActionResult, type DevicesStore } from '../../core/stores/devices.store';
import { schemaValidator } from '../../core/validators/schema.validator';

// context the list component passes into the dialog. the store instance rides the
// context (not DI) because the dialog renders in a cdk overlay outside the route
// injector that provides DevicesStore.
export interface DeviceFormDialogContext {
  device: Device | null;
  mode: 'create' | 'edit';
  store: DevicesStore;
}

// single-step add/edit form: device identity (name + host) plus ssh credentials
// (username, authType, secret). create issues the store's two-call flow; edit
// patches name/host and, when a secret is supplied, replaces the credential via
// delete + recreate. the secret control swaps single-line (password) vs multiline
// (private key) on the authType value.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    HlmButton,
    HlmInput,
    HlmLabel,
    HlmDialogHeader,
    HlmDialogFooter,
    HlmDialogTitle,
    HlmDialogDescription,
    ...HlmSelectImports,
  ],
  selector: 'app-device-form-dialog',
  templateUrl: './device-form.dialog.html',
})
export class DeviceFormDialog {
  private readonly context = injectBrnDialogContext<DeviceFormDialogContext>();
  private readonly dialogRef = inject(BrnDialogRef);
  private readonly formBuilder = inject(FormBuilder);

  protected readonly errorMessage = signal<null | string>(null);

  protected readonly form = this.formBuilder.nonNullable.group({
    authType: this.formBuilder.nonNullable.control<'key' | 'password'>('password', {
      validators: [schemaValidator(credentialCreateRequestSchema.shape.authType)],
    }),
    host: ['', [schemaValidator(deviceCreateRequestSchema.shape.host)]],
    name: ['', [schemaValidator(deviceCreateRequestSchema.shape.name)]],
    secret: ['', [schemaValidator(credentialCreateRequestSchema.shape.secret)]],
    username: ['', [schemaValidator(credentialCreateRequestSchema.shape.username)]],
  });

  protected readonly isEdit = this.context.mode === 'edit';

  protected readonly submitting = signal(false);

  // reactive mirror of the authType control so the template swaps the secret
  // control (single-line vs textarea) without relying on zone change detection.
  private readonly authType = toSignal(this.form.controls.authType.valueChanges, {
    initialValue: this.form.controls.authType.value,
  });

  protected readonly secretIsKey = computed(() => this.authType() === 'key');

  // human label for the authType select trigger.
  protected readonly authTypeLabel = (value: string): string => (value === 'key' ? 'SSH key' : 'Password');

  constructor() {
    if (this.isEdit && this.context.device) {
      this.form.patchValue({ host: this.context.device.host, name: this.context.device.name });
      // credentials are optional on edit — a blank secret leaves them untouched.
      this.form.controls.username.clearValidators();
      this.form.controls.secret.clearValidators();
      this.form.controls.username.updateValueAndValidity();
      this.form.controls.secret.updateValueAndValidity();
    }
  }

  cancel(): void {
    this.dialogRef.close();
  }

  async submit(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.submitting.set(true);
    this.errorMessage.set(null);
    const value = this.form.getRawValue();

    if (!this.isEdit) {
      const result = await this.context.store.add(
        { host: value.host, name: value.name },
        { authType: value.authType, secret: value.secret, username: value.username }
      );
      this.finish(result);
      return;
    }

    const device = this.context.device;
    if (!device) {
      this.finish({ error: 'no device to edit' });
      return;
    }

    const updateResult = await this.context.store.update(device.id, { host: value.host, name: value.name });
    if (updateResult.error) {
      this.finish(updateResult);
      return;
    }

    // replace credentials only when the operator supplied new ones; require both
    // username and secret together so a half-filled replace can't slip through.
    const wantsReplace = value.secret.trim() !== '' || value.username.trim() !== '';
    if (!wantsReplace) {
      this.finish({ error: null });
      return;
    }
    if (value.secret.trim() === '' || value.username.trim() === '') {
      this.submitting.set(false);
      this.errorMessage.set('enter both username and secret to replace credentials');
      return;
    }
    const replaceResult = await this.context.store.replaceCredential(device.id, {
      authType: value.authType,
      secret: value.secret,
      username: value.username,
    });
    this.finish(replaceResult);
  }

  private finish(result: DeviceActionResult): void {
    this.submitting.set(false);
    if (result.error) {
      this.errorMessage.set(result.error);
      return;
    }
    this.dialogRef.close(true);
  }
}
