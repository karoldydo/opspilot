import { describe, expect, it } from 'vitest';

import { skillRunResultSchema } from './skill-run-result.schema';

describe('skillRunResultSchema', () => {
  it('accepts a succeeded and a failed result', () => {
    expect(skillRunResultSchema.safeParse({ message: 'started web-proxy', status: 'succeeded' }).success).toBe(true);
    expect(skillRunResultSchema.safeParse({ message: 'no such container', status: 'failed' }).success).toBe(true);
  });

  it('rejects an unknown status', () => {
    expect(skillRunResultSchema.safeParse({ message: 'x', status: 'pending' }).success).toBe(false);
  });

  it('rejects an unknown key (strict)', () => {
    expect(skillRunResultSchema.safeParse({ message: 'x', operation: 'start', status: 'succeeded' }).success).toBe(
      false
    );
  });
});
