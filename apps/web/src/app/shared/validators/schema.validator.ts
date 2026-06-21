import { type AbstractControl, type ValidatorFn } from '@angular/forms';
import { type ZodType } from 'zod';

// bridges a shared zod field schema into a ValidatorFn so forms validate against the
// single source of truth, no fe-only rules (contracts.md). pass a per-field schema.
export function schemaValidator(zodType: ZodType): ValidatorFn {
  return (control: AbstractControl) => {
    const result = zodType.safeParse(control.value);
    if (result.success) {
      return null;
    }
    return { zod: result.error.issues[0]?.message ?? 'invalid value' };
  };
}
