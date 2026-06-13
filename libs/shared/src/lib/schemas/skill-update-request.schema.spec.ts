import { describe, expect, it } from 'vitest';

import { skillUpdateRequestSchema } from './skill-update-request.schema';

describe('skillUpdateRequestSchema', () => {
  it('accepts a single-field patch', () => {
    expect(skillUpdateRequestSchema.safeParse({ name: 'restart' }).success).toBe(true);
    expect(skillUpdateRequestSchema.safeParse({ timeoutMs: 60000 }).success).toBe(true);
    expect(skillUpdateRequestSchema.safeParse({ deviceId: null }).success).toBe(true);
  });

  it('accepts a paired commandTemplate + parameters patch', () => {
    expect(
      skillUpdateRequestSchema.safeParse({
        commandTemplate: 'docker restart {{containerName}}',
        parameters: [{ name: 'containerName', required: true, source: 'service' }],
      }).success
    ).toBe(true);
  });

  it('rejects an empty patch (at least one field required)', () => {
    expect(skillUpdateRequestSchema.safeParse({}).success).toBe(false);
  });

  it('rejects an unknown key (strict)', () => {
    expect(skillUpdateRequestSchema.safeParse({ name: 'restart', secret: 'x' }).success).toBe(false);
  });
});
