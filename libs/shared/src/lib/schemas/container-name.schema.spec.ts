import { describe, expect, it } from 'vitest';

import { containerNameSchema } from './container-name.schema';

describe('containerNameSchema', () => {
  it('accepts a docker-legal name', () => {
    expect(containerNameSchema.safeParse('web-proxy').success).toBe(true);
    expect(containerNameSchema.safeParse('app_1.svc').success).toBe(true);
    expect(containerNameSchema.safeParse('a').success).toBe(true);
  });

  it('rejects an empty name', () => {
    expect(containerNameSchema.safeParse('').success).toBe(false);
  });

  it('rejects a leading non-alphanumeric character', () => {
    expect(containerNameSchema.safeParse('-leading').success).toBe(false);
    expect(containerNameSchema.safeParse('.leading').success).toBe(false);
  });

  it('rejects shell metacharacters (command-injection guard)', () => {
    expect(containerNameSchema.safeParse('foo; rm -rf /').success).toBe(false);
    expect(containerNameSchema.safeParse('foo$(curl evil)').success).toBe(false);
    expect(containerNameSchema.safeParse('foo`id`').success).toBe(false);
    expect(containerNameSchema.safeParse('foo && bar').success).toBe(false);
    expect(containerNameSchema.safeParse('foo|bar').success).toBe(false);
  });
});
