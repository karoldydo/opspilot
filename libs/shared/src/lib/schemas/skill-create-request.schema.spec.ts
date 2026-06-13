import { describe, expect, it } from 'vitest';

import { skillCreateRequestSchema } from './skill-create-request.schema';

describe('skillCreateRequestSchema', () => {
  it('parses a valid global skill create body', () => {
    expect(
      skillCreateRequestSchema.safeParse({
        commandTemplate: 'docker start {{containerName}}',
        name: 'start',
        parameters: [{ name: 'containerName', required: true, source: 'service' }],
      }).success
    ).toBe(true);
  });

  it('accepts an explicit deviceId and timeoutMs', () => {
    expect(
      skillCreateRequestSchema.safeParse({
        commandTemplate: 'docker logs {{containerName}}',
        deviceId: '22222222-2222-4222-8222-222222222222',
        name: 'logs',
        parameters: [{ name: 'containerName', required: true, source: 'service' }],
        timeoutMs: 30000,
      }).success
    ).toBe(true);
  });

  it('accepts a fixed command with no placeholders and no parameters', () => {
    expect(
      skillCreateRequestSchema.safeParse({ commandTemplate: 'docker ps', name: 'ps', parameters: [] }).success
    ).toBe(true);
  });

  it('rejects a template with an undeclared placeholder (parity)', () => {
    expect(
      skillCreateRequestSchema.safeParse({
        commandTemplate: 'docker start {{containerName}}',
        name: 'start',
        parameters: [],
      }).success
    ).toBe(false);
  });

  it('rejects a parameter that has no matching placeholder (parity)', () => {
    expect(
      skillCreateRequestSchema.safeParse({
        commandTemplate: 'docker ps',
        name: 'ps',
        parameters: [{ name: 'containerName', required: true, source: 'service' }],
      }).success
    ).toBe(false);
  });

  it('rejects duplicate parameter names', () => {
    expect(
      skillCreateRequestSchema.safeParse({
        commandTemplate: 'docker start {{containerName}}',
        name: 'start',
        parameters: [
          { name: 'containerName', required: true, source: 'service' },
          { name: 'containerName', required: false, source: 'input' },
        ],
      }).success
    ).toBe(false);
  });

  it('rejects an empty name and an unknown key (strict)', () => {
    expect(skillCreateRequestSchema.safeParse({ commandTemplate: 'docker ps', name: '', parameters: [] }).success).toBe(
      false
    );
    expect(
      skillCreateRequestSchema.safeParse({ commandTemplate: 'docker ps', name: 'ps', parameters: [], secret: 'x' })
        .success
    ).toBe(false);
  });
});
