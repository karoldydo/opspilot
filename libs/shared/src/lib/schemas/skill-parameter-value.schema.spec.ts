import { describe, expect, it } from 'vitest';

import { skillParameterValueSchema } from './skill-parameter-value.schema';

describe('skillParameterValueSchema', () => {
  it('accepts values for container names, compose paths, and project names', () => {
    expect(skillParameterValueSchema.safeParse('web-proxy').success).toBe(true);
    expect(skillParameterValueSchema.safeParse('app_1.svc').success).toBe(true);
    expect(skillParameterValueSchema.safeParse('/volume1/docker/opspilot/docker-compose.yml').success).toBe(true);
    expect(skillParameterValueSchema.safeParse('my-project_01').success).toBe(true);
    expect(skillParameterValueSchema.safeParse('nginx:1.25').success).toBe(true);
  });

  it('rejects an empty value', () => {
    expect(skillParameterValueSchema.safeParse('').success).toBe(false);
  });

  it('rejects shell metacharacters (command-injection guard)', () => {
    expect(skillParameterValueSchema.safeParse('foo; rm -rf /').success).toBe(false);
    expect(skillParameterValueSchema.safeParse('foo$(curl evil)').success).toBe(false);
    expect(skillParameterValueSchema.safeParse('foo`id`').success).toBe(false);
    expect(skillParameterValueSchema.safeParse('foo && bar').success).toBe(false);
    expect(skillParameterValueSchema.safeParse('foo|bar').success).toBe(false);
    expect(skillParameterValueSchema.safeParse('foo bar').success).toBe(false);
    expect(skillParameterValueSchema.safeParse("foo'bar").success).toBe(false);
  });
});
