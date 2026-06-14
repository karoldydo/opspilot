import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, type FormControl, type FormGroup, ReactiveFormsModule } from '@angular/forms';
import { schemaValidator } from '@app/shared/validators/schema.validator';
import {
  type Device,
  type Skill,
  type SkillCreateRequest,
  skillCreateRequestSchema,
  skillParameterSchema,
} from '@opspilot/shared';
import { BrnDialogRef, injectBrnDialogContext } from '@spartan-ng/brain/dialog';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmCheckbox } from '@spartan-ng/helm/checkbox';
import { HlmDialogDescription, HlmDialogFooter, HlmDialogHeader, HlmDialogTitle } from '@spartan-ng/helm/dialog';
import { HlmInput } from '@spartan-ng/helm/input';
import { HlmLabel } from '@spartan-ng/helm/label';
import { HlmSelectImports } from '@spartan-ng/helm/select';

import { type SkillActionResult, type SkillsStore } from '../../core/stores/skills.store';

// context the list component passes into the dialog. the store instance and the
// device list ride the context (not DI) because the dialog renders in a cdk overlay
// outside the route injector that provides SkillsStore; the device list drives the
// scope select (global vs a device).
export interface SkillFormDialogContext {
  devices: Device[];
  mode: 'create' | 'edit';
  skill: null | Skill;
  store: SkillsStore;
}

// one typed parameter row in the parameters FormArray.
type ParameterGroup = FormGroup<{
  name: FormControl<string>;
  required: FormControl<boolean>;
  source: FormControl<'input' | 'service'>;
}>;

// add/edit form for a skill: name, command template, scope (global vs a device),
// optional per-skill timeout, and a list of typed parameters (name + source). the
// parameter/placeholder parity and per-scope name uniqueness are re-checked against
// the shared schema on submit (no second, fe-only rule) and again server-side.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    HlmButton,
    HlmCheckbox,
    HlmInput,
    HlmLabel,
    HlmDialogHeader,
    HlmDialogFooter,
    HlmDialogTitle,
    HlmDialogDescription,
    ...HlmSelectImports,
  ],
  selector: 'app-skill-form-dialog',
  templateUrl: './skill-form.dialog.html',
})
export class SkillFormDialog {
  private readonly context = injectBrnDialogContext<SkillFormDialogContext>();
  private readonly dialogRef = inject(BrnDialogRef);
  private readonly formBuilder = inject(FormBuilder);

  protected readonly devices = this.context.devices;

  protected readonly errorMessage = signal<null | string>(null);

  protected readonly form = this.formBuilder.nonNullable.group({
    commandTemplate: ['', [schemaValidator(skillCreateRequestSchema.shape.commandTemplate)]],
    // '' = global scope; a uuid scopes the skill to that device. converted to null on
    // submit; no schema validator — the select can only hold valid options.
    deviceId: [''],
    name: ['', [schemaValidator(skillCreateRequestSchema.shape.name)]],
    parameters: this.formBuilder.array<ParameterGroup>([]),
    // a number input yields null when blank; null inherits the config default timeout.
    timeoutMs: this.formBuilder.nonNullable.control<null | number>(null, {
      validators: [schemaValidator(skillCreateRequestSchema.shape.timeoutMs)],
    }),
  });

  protected readonly isEdit = this.context.mode === 'edit';

  protected readonly submitting = signal(false);

  // human label for the scope select trigger.
  protected readonly scopeLabel = (value: string): string =>
    value === '' ? 'Global' : (this.devices.find((device) => device.id === value)?.name ?? value);

  // human label for the parameter source select trigger.
  protected readonly sourceLabel = (value: string): string => (value === 'service' ? 'Service' : 'Input');

  constructor() {
    const skill = this.context.skill;
    if (this.isEdit && skill) {
      this.form.patchValue({
        commandTemplate: skill.commandTemplate,
        deviceId: skill.deviceId ?? '',
        name: skill.name,
        timeoutMs: skill.timeoutMs,
      });
      for (const parameter of skill.parameters) {
        this.form.controls.parameters.push(this.createParameter(parameter.name, parameter.source, parameter.required));
      }
    }
  }

  addParameter(): void {
    this.form.controls.parameters.push(this.createParameter());
  }

  cancel(): void {
    this.dialogRef.close();
  }

  removeParameter(index: number): void {
    this.form.controls.parameters.removeAt(index);
  }

  async submit(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const value = this.form.getRawValue();
    const payload: SkillCreateRequest = {
      commandTemplate: value.commandTemplate,
      deviceId: value.deviceId === '' ? null : value.deviceId,
      name: value.name,
      parameters: value.parameters,
      timeoutMs: value.timeoutMs,
    };

    // the form always assembles a complete skill, so re-check the parameter/
    // placeholder parity against the shared create schema in both modes, surfacing
    // the cross-field message inline before the round-trip (the edit path then sends
    // the full payload as a patch — the server re-validates parity on the merged row).
    const parsed = skillCreateRequestSchema.safeParse(payload);
    if (!parsed.success) {
      this.errorMessage.set(parsed.error.issues[0]?.message ?? 'invalid skill');
      return;
    }
    this.submitting.set(true);
    this.errorMessage.set(null);

    if (!this.isEdit) {
      this.finish(await this.context.store.create(parsed.data));
      return;
    }

    const skill = this.context.skill;
    if (!skill) {
      this.finish({ error: 'no skill to edit' });
      return;
    }
    this.finish(await this.context.store.update(skill.id, parsed.data));
  }

  private createParameter(name = '', source: 'input' | 'service' = 'input', required = true): ParameterGroup {
    return this.formBuilder.nonNullable.group({
      name: [name, [schemaValidator(skillParameterSchema.shape.name)]],
      required: [required],
      source: this.formBuilder.nonNullable.control<'input' | 'service'>(source, {
        validators: [schemaValidator(skillParameterSchema.shape.source)],
      }),
    });
  }

  private finish(result: SkillActionResult): void {
    this.submitting.set(false);
    if (result.error) {
      this.errorMessage.set(result.error);
      return;
    }
    this.dialogRef.close(true);
  }
}
