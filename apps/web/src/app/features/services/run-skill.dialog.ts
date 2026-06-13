import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import {
  type AbstractControl,
  FormBuilder,
  type FormControl,
  ReactiveFormsModule,
  type ValidatorFn,
} from '@angular/forms';
import { type Skill, type SkillParameter, skillParameterValueSchema } from '@opspilot/shared';
import { BrnDialogRef, injectBrnDialogContext } from '@spartan-ng/brain/dialog';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmDialogDescription, HlmDialogFooter, HlmDialogHeader, HlmDialogTitle } from '@spartan-ng/helm/dialog';
import { HlmInput } from '@spartan-ng/helm/input';
import { HlmLabel } from '@spartan-ng/helm/label';

import { type SkillRunStore } from '../../core/stores/skill-run.store';
import { schemaValidator } from '../../core/validators/schema.validator';

// context the service-skills component passes in. the store instance rides the
// context (not DI) because the dialog renders in a cdk overlay outside the component
// injector that provides SkillRunStore. serviceName drives the confirm copy.
export interface RunSkillDialogContext {
  deviceId: string;
  serviceId: string;
  serviceName: string;
  skill: Skill;
  store: SkillRunStore;
}

// allows an empty optional input (the run request simply omits it), otherwise
// delegates to the charset schema — the same value guard the server re-applies at
// the shell boundary.
function optionalValueValidator(): ValidatorFn {
  const required = schemaValidator(skillParameterValueSchema);
  return (control: AbstractControl) => (control.value === '' ? null : required(control));
}

// the uniform run affordance for one skill on one service: a command preview (so the
// dialog doubles as the destructive-action confirm — the data model carries no
// destructive flag) plus a field per `input`-source parameter. `service`-source
// params are filled server-side from the resolved service row and never appear here.
// running posts the collected inputs through the store, which keeps the per-service
// result line on the row below.
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
  selector: 'app-run-skill-dialog',
  templateUrl: './run-skill.dialog.html',
})
export class RunSkillDialog {
  private readonly context = injectBrnDialogContext<RunSkillDialogContext>();
  private readonly dialogRef = inject(BrnDialogRef);
  private readonly formBuilder = inject(FormBuilder);

  protected readonly commandTemplate = this.context.skill.commandTemplate;

  protected readonly errorMessage = signal<null | string>(null);

  // only `input`-source params are caller-supplied; `service` params resolve server-side.
  protected readonly inputParameters = this.context.skill.parameters.filter(
    (parameter) => parameter.source === 'input'
  );

  protected readonly serviceName = this.context.serviceName;

  protected readonly skillName = this.context.skill.name;

  protected readonly submitting = signal(false);

  // one control per input param, keyed by name so the payload maps straight back.
  // required params use the charset schema; optional ones allow empty (then omitted).
  protected readonly form = this.formBuilder.nonNullable.group(
    Object.fromEntries(
      this.inputParameters.map((parameter) => [parameter.name, this.createControl(parameter)] as const)
    )
  );

  cancel(): void {
    this.dialogRef.close();
  }

  async submit(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    // drop empty optional values so the run request omits them (each kept value is
    // already charset-valid via the control validator; the server re-checks anyway).
    const raw = this.form.getRawValue();
    const inputs: Record<string, string> = {};
    for (const [name, value] of Object.entries(raw)) {
      if (value !== '') {
        inputs[name] = value;
      }
    }
    this.submitting.set(true);
    this.errorMessage.set(null);
    const result = await this.context.store.run(this.context.deviceId, this.context.serviceId, this.context.skill.id, {
      inputs,
    });
    this.submitting.set(false);
    if (result.error) {
      this.errorMessage.set(result.error);
      return;
    }
    this.dialogRef.close(true);
  }

  private createControl(parameter: SkillParameter): FormControl<string> {
    return this.formBuilder.nonNullable.control('', [
      parameter.required ? schemaValidator(skillParameterValueSchema) : optionalValueValidator(),
    ]);
  }
}
