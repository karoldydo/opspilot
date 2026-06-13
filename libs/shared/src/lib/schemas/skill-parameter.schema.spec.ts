import { describe, expect, it } from 'vitest';

import { skillParameterSchema } from './skill-parameter.schema';

describe('skillParameterSchema', () => {
  it('accepts an input parameter with a legal identifier name', () => {
    expect(skillParameterSchema.safeParse({ name: 'tag', required: true, source: 'input' }).success).toBe(true);
  });

  it('accepts a service parameter bound to a known service field', () => {
    expect(skillParameterSchema.safeParse({ name: 'containerName', required: true, source: 'service' }).success).toBe(
      true
    );
    expect(skillParameterSchema.safeParse({ name: 'composePath', required: true, source: 'service' }).success).toBe(
      true
    );
    expect(skillParameterSchema.safeParse({ name: 'composeProject', required: true, source: 'service' }).success).toBe(
      true
    );
  });

  it('rejects a service parameter that does not bind to a known service field', () => {
    expect(skillParameterSchema.safeParse({ name: 'tag', required: true, source: 'service' }).success).toBe(false);
  });

  it('rejects a name that is not a {{placeholder}}-legal identifier', () => {
    expect(skillParameterSchema.safeParse({ name: '1tag', required: true, source: 'input' }).success).toBe(false);
    expect(skillParameterSchema.safeParse({ name: 'a-b', required: true, source: 'input' }).success).toBe(false);
    expect(skillParameterSchema.safeParse({ name: '', required: true, source: 'input' }).success).toBe(false);
  });

  it('rejects an unknown source and an unknown key (strict)', () => {
    expect(skillParameterSchema.safeParse({ name: 'tag', required: true, source: 'env' }).success).toBe(false);
    expect(skillParameterSchema.safeParse({ extra: 1, name: 'tag', required: true, source: 'input' }).success).toBe(
      false
    );
  });
});
