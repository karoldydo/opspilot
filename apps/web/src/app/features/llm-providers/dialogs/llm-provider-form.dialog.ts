import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import {
  type LlmProviderActionResult,
  type LlmProvidersStore,
} from '@app/features/llm-providers/data/llm-providers.store';
import { schemaValidator } from '@app/shared/validators/schema.validator';
import { type LlmProvider, llmProviderCreateRequestSchema, type LlmProviderUpdateRequest } from '@opspilot/shared';
import { BrnDialogRef, injectBrnDialogContext } from '@spartan-ng/brain/dialog';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmDialogDescription, HlmDialogFooter, HlmDialogHeader, HlmDialogTitle } from '@spartan-ng/helm/dialog';
import { HlmInput } from '@spartan-ng/helm/input';
import { HlmLabel } from '@spartan-ng/helm/label';
import { HlmSelectImports } from '@spartan-ng/helm/select';

// context passed into the dialog — the store rides context not DI because the dialog renders in a cdk overlay outside the injector that provides LlmProvidersStore.
export interface LlmProviderFormDialogContext {
  mode: 'create' | 'edit';
  provider: LlmProvider | null;
  store: LlmProvidersStore;
}

// single-step add/edit form (kind + baseURL + model + apiKey). create runs the store's create flow (the server test-calls the endpoint before persisting); edit patches baseURL/model/kind and rotates the key only when an apiKey is supplied, a blank one keeping the stored key.
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
  selector: 'app-llm-provider-form-dialog',
  templateUrl: './llm-provider-form.dialog.html',
})
export class LlmProviderFormDialog {
  private readonly context = injectBrnDialogContext<LlmProviderFormDialogContext>();
  private readonly dialogRef = inject(BrnDialogRef);
  private readonly formBuilder = inject(FormBuilder);

  protected readonly errorMessage = signal<null | string>(null);

  protected readonly form = this.formBuilder.nonNullable.group({
    apiKey: ['', [schemaValidator(llmProviderCreateRequestSchema.shape.apiKey)]],
    baseURL: ['', [schemaValidator(llmProviderCreateRequestSchema.shape.baseURL)]],
    kind: this.formBuilder.nonNullable.control<'openai-compatible'>('openai-compatible', {
      validators: [schemaValidator(llmProviderCreateRequestSchema.shape.kind)],
    }),
    model: ['', [schemaValidator(llmProviderCreateRequestSchema.shape.model)]],
  });

  protected readonly isEdit = this.context.mode === 'edit';

  protected readonly submitting = signal(false);

  protected readonly kindLabel = (value: string): string =>
    value === 'openai-compatible' ? 'OpenAI-compatible' : value;

  constructor() {
    if (this.isEdit && this.context.provider) {
      this.form.patchValue({
        baseURL: this.context.provider.baseURL,
        kind: this.context.provider.kind,
        model: this.context.provider.model,
      });
      // the apiKey is optional on edit — a blank value keeps the stored key.
      this.form.controls.apiKey.clearValidators();
      this.form.controls.apiKey.updateValueAndValidity();
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
      const result = await this.context.store.create({
        apiKey: value.apiKey,
        baseURL: value.baseURL,
        kind: value.kind,
        model: value.model,
      });
      this.finish(result);
      return;
    }

    const provider = this.context.provider;
    if (!provider) {
      this.finish({ error: 'no provider to edit' });
      return;
    }

    // build a minimal patch: always send baseURL/model/kind; include apiKey only
    // when the operator supplied a new one so an empty value keeps the stored key.
    const patch: LlmProviderUpdateRequest = { baseURL: value.baseURL, kind: value.kind, model: value.model };
    if (value.apiKey.trim() !== '') {
      patch.apiKey = value.apiKey;
    }
    const result = await this.context.store.update(provider.id, patch);
    this.finish(result);
  }

  private finish(result: LlmProviderActionResult): void {
    this.submitting.set(false);
    if (result.error) {
      this.errorMessage.set(result.error);
      return;
    }
    this.dialogRef.close(true);
  }
}
