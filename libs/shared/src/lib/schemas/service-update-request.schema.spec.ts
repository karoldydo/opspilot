import { serviceUpdateRequestSchema } from './service-update-request.schema';

describe('serviceUpdateRequestSchema', () => {
  it('parses a valid name-only body', () => {
    expect(serviceUpdateRequestSchema.parse({ name: 'web proxy' })).toEqual({ name: 'web proxy' });
  });

  it('rejects an empty name', () => {
    expect(serviceUpdateRequestSchema.safeParse({ name: '' }).success).toBe(false);
  });

  it('rejects an unknown key (strict) — identity fields are immutable', () => {
    expect(serviceUpdateRequestSchema.safeParse({ containerName: 'other', name: 'web proxy' }).success).toBe(false);
  });
});
