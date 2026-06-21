import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { type ServicesStore } from '@app/features/services/data/services.store';
import { schemaValidator } from '@app/shared/validators/schema.validator';
import { type Service, serviceUpdateRequestSchema } from '@opspilot/shared';
import { BrnDialogRef, injectBrnDialogContext } from '@spartan-ng/brain/dialog';
import { toast } from '@spartan-ng/brain/sonner';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmDialogDescription, HlmDialogFooter, HlmDialogHeader, HlmDialogTitle } from '@spartan-ng/helm/dialog';
import { HlmInput } from '@spartan-ng/helm/input';
import { HlmLabel } from '@spartan-ng/helm/label';

// context the device-services component passes in. the store rides the context
// (not DI) because the dialog renders in a cdk overlay outside the component
// injector that provides ServicesStore.
export interface RenameServiceDialogContext {
  deviceId: string;
  service: Service;
  store: ServicesStore;
}

// name-only edit form — identity fields (containerName/composeProject/composePath)
// are scan-derived and immutable, so renaming is the only mutation a managed
// service allows.
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
  ],
  selector: 'app-rename-service-dialog',
  templateUrl: './rename-service.dialog.html',
})
export class RenameServiceDialog {
  private readonly context = injectBrnDialogContext<RenameServiceDialogContext>();
  private readonly dialogRef = inject(BrnDialogRef);
  private readonly formBuilder = inject(FormBuilder);

  protected readonly containerName = this.context.service.containerName;

  protected readonly errorMessage = signal<null | string>(null);

  protected readonly form = this.formBuilder.nonNullable.group({
    name: [this.context.service.name, [schemaValidator(serviceUpdateRequestSchema.shape.name)]],
  });

  protected readonly submitting = signal(false);

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
    const result = await this.context.store.rename(
      this.context.deviceId,
      this.context.service.id,
      this.form.getRawValue().name
    );
    this.submitting.set(false);
    if (result.error) {
      this.errorMessage.set(result.error);
      return;
    }
    toast('[+] service renamed');
    this.dialogRef.close(true);
  }
}
