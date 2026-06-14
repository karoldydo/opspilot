import { FormControl } from '@angular/forms';
import { schemaValidator } from '@app/shared/validators/schema.validator';
import { skillCreateRequestSchema, skillParameterSchema } from '@opspilot/shared';

// the skill form derives every field validator from the shared schema (contracts.md:
// no second, fe-only rule). these tests pin that the bridge wires the skill schemas
// correctly and that the parity check the submit handler relies on rejects a
// template/parameter mismatch.
describe('skill form validators', () => {
  it('rejects an empty name and accepts a non-empty one', () => {
    const validate = schemaValidator(skillCreateRequestSchema.shape.name);
    expect(validate(new FormControl(''))).not.toBeNull();
    expect(validate(new FormControl('restart'))).toBeNull();
  });

  it('rejects a malformed command template', () => {
    const validate = schemaValidator(skillCreateRequestSchema.shape.commandTemplate);
    expect(validate(new FormControl(''))).not.toBeNull();
    expect(validate(new FormControl('docker restart {{1bad}}'))).not.toBeNull();
    expect(validate(new FormControl('docker restart {{containerName}}'))).toBeNull();
  });

  it('rejects a parameter name that is not a {{placeholder}}-legal identifier', () => {
    const validate = schemaValidator(skillParameterSchema.shape.name);
    expect(validate(new FormControl('1bad'))).not.toBeNull();
    expect(validate(new FormControl('containerName'))).toBeNull();
  });

  it('rejects a template/parameter mismatch on the assembled payload', () => {
    // an undeclared {{placeholder}} fails the cross-field parity refine — the same
    // check the form runs before the round-trip.
    const mismatch = skillCreateRequestSchema.safeParse({
      commandTemplate: 'docker restart {{containerName}}',
      deviceId: null,
      name: 'restart',
      parameters: [],
      timeoutMs: null,
    });
    expect(mismatch.success).toBe(false);

    const matched = skillCreateRequestSchema.safeParse({
      commandTemplate: 'docker restart {{containerName}}',
      deviceId: null,
      name: 'restart',
      parameters: [{ name: 'containerName', required: true, source: 'service' }],
      timeoutMs: null,
    });
    expect(matched.success).toBe(true);
  });
});
