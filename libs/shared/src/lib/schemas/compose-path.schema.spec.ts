import { describe, expect, it } from 'vitest';

import { composePathSchema } from './compose-path.schema';

describe('composePathSchema', () => {
  it('accepts a metacharacter-free filesystem path', () => {
    expect(composePathSchema.safeParse('/volume1/docker/app/docker-compose.yml').success).toBe(true);
    expect(composePathSchema.safeParse('compose.yaml').success).toBe(true);
    expect(composePathSchema.safeParse('./stack/app_1.yml').success).toBe(true);
  });

  it('rejects an empty value', () => {
    expect(composePathSchema.safeParse('').success).toBe(false);
  });

  it('rejects shell metacharacters (command-injection guard)', () => {
    expect(composePathSchema.safeParse('/etc/x; rm -rf /').success).toBe(false);
    expect(composePathSchema.safeParse('/etc/x$(id)').success).toBe(false);
    expect(composePathSchema.safeParse('/etc/x `id`').success).toBe(false);
    expect(composePathSchema.safeParse('/etc/x|y').success).toBe(false);
    expect(composePathSchema.safeParse('/path with space/c.yml').success).toBe(false);
  });
});
