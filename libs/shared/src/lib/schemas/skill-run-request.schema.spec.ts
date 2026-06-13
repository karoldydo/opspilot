import { describe, expect, it } from 'vitest';

import { skillRunRequestSchema } from './skill-run-request.schema';

describe('skillRunRequestSchema', () => {
  it('defaults inputs to an empty record when omitted', () => {
    expect(skillRunRequestSchema.parse({})).toEqual({ inputs: {} });
  });

  it('accepts a record of charset-valid input values', () => {
    expect(skillRunRequestSchema.safeParse({ inputs: { tag: 'nginx:1.25' } }).success).toBe(true);
  });

  it('rejects an input value with a shell metacharacter', () => {
    expect(skillRunRequestSchema.safeParse({ inputs: { tag: 'foo; rm -rf /' } }).success).toBe(false);
  });

  it('rejects an unknown key (strict)', () => {
    expect(skillRunRequestSchema.safeParse({ extra: 1, inputs: {} }).success).toBe(false);
  });
});
