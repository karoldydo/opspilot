import { describe, expect, it } from 'vitest';

import { composeProjectSchema } from './compose-project.schema';

describe('composeProjectSchema', () => {
  it('accepts a docker-compose-legal project name', () => {
    expect(composeProjectSchema.safeParse('myproject').success).toBe(true);
    expect(composeProjectSchema.safeParse('app_1-stack').success).toBe(true);
    expect(composeProjectSchema.safeParse('0a').success).toBe(true);
  });

  it('rejects an empty value', () => {
    expect(composeProjectSchema.safeParse('').success).toBe(false);
  });

  it('rejects uppercase and a leading separator', () => {
    expect(composeProjectSchema.safeParse('MyProject').success).toBe(false);
    expect(composeProjectSchema.safeParse('-leading').success).toBe(false);
  });

  it('rejects shell metacharacters (command-injection guard)', () => {
    expect(composeProjectSchema.safeParse('proj; rm -rf /').success).toBe(false);
    expect(composeProjectSchema.safeParse('proj$(id)').success).toBe(false);
    expect(composeProjectSchema.safeParse('proj name').success).toBe(false);
  });
});
