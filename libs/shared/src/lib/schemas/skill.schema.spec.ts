import { describe, expect, it } from 'vitest';

import { skillSchema } from './skill.schema';

describe('skillSchema', () => {
  const base = {
    commandTemplate: 'docker start {{containerName}}',
    createdAt: '2026-06-13T10:00:00.000Z',
    deviceId: null,
    id: '11111111-1111-4111-8111-111111111111',
    name: 'start',
    parameters: [{ name: 'containerName', required: true, source: 'service' }],
    timeoutMs: null,
    updatedAt: '2026-06-13T10:00:00.000Z',
  };

  it('parses a valid global skill (deviceId null)', () => {
    expect(skillSchema.safeParse(base).success).toBe(true);
  });

  it('parses a per-device skill with a positive timeoutMs', () => {
    expect(
      skillSchema.safeParse({
        ...base,
        deviceId: '22222222-2222-4222-8222-222222222222',
        timeoutMs: 30000,
      }).success
    ).toBe(true);
  });

  it('normalizes a Date timestamp to an iso string', () => {
    const parsed = skillSchema.parse({ ...base, createdAt: new Date('2026-06-13T10:00:00.000Z') });
    expect(parsed.createdAt).toBe('2026-06-13T10:00:00.000Z');
  });

  it('rejects a non-uuid id and a non-positive timeoutMs', () => {
    expect(skillSchema.safeParse({ ...base, id: 'not-a-uuid' }).success).toBe(false);
    expect(skillSchema.safeParse({ ...base, timeoutMs: 0 }).success).toBe(false);
  });

  it('rejects an unknown key (strict)', () => {
    expect(skillSchema.safeParse({ ...base, secret: 'x' }).success).toBe(false);
  });
});
