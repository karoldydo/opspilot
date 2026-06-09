import { credentialListQuerySchema } from './credential-list-query.schema';

describe('credentialListQuerySchema', () => {
  it('defaults offset to 0 and leaves limit unset', () => {
    const parsed = credentialListQuerySchema.parse({});

    expect(parsed.offset).toBe(0);
    expect(parsed.limit).toBeUndefined();
  });

  it('coerces query strings to numbers', () => {
    const parsed = credentialListQuerySchema.parse({ limit: '25', offset: '10' });

    expect(parsed.limit).toBe(25);
    expect(parsed.offset).toBe(10);
  });

  it('rejects a limit above the ceiling', () => {
    const result = credentialListQuerySchema.safeParse({ limit: '101' });

    expect(result.success).toBe(false);
  });

  it('rejects a negative offset', () => {
    const result = credentialListQuerySchema.safeParse({ offset: '-1' });

    expect(result.success).toBe(false);
  });
});
