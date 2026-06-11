import { describe, expect, it } from 'vitest';

import { serviceOperationRequestSchema } from './service-operation-request.schema';

describe('serviceOperationRequestSchema', () => {
  it('accepts a body carrying one valid operation', () => {
    expect(serviceOperationRequestSchema.safeParse({ operation: 'restart' }).success).toBe(true);
  });

  it('rejects an unknown operation', () => {
    expect(serviceOperationRequestSchema.safeParse({ operation: 'exec' }).success).toBe(false);
  });

  it('rejects a missing operation', () => {
    expect(serviceOperationRequestSchema.safeParse({}).success).toBe(false);
  });

  it('rejects extra keys (closed object)', () => {
    expect(serviceOperationRequestSchema.safeParse({ extra: true, operation: 'up' }).success).toBe(false);
  });
});
