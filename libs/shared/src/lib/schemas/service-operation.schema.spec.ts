import { describe, expect, it } from 'vitest';

import { serviceOperationResultSchema, serviceOperationSchema } from './service-operation.schema';

describe('serviceOperationSchema', () => {
  it('accepts each of the 5 fixed operations', () => {
    for (const op of ['start', 'stop', 'restart', 'up', 'down']) {
      expect(serviceOperationSchema.safeParse(op).success).toBe(true);
    }
  });

  it('rejects an unknown operation (predefined-skills guardrail)', () => {
    expect(serviceOperationSchema.safeParse('exec').success).toBe(false);
    expect(serviceOperationSchema.safeParse('').success).toBe(false);
  });
});

describe('serviceOperationResultSchema', () => {
  it('accepts a well-formed result envelope', () => {
    expect(
      serviceOperationResultSchema.safeParse({ message: 'ok', operation: 'start', status: 'succeeded' }).success
    ).toBe(true);
    expect(
      serviceOperationResultSchema.safeParse({ message: 'no such container', operation: 'stop', status: 'failed' })
        .success
    ).toBe(true);
  });

  it('rejects an unknown status', () => {
    expect(serviceOperationResultSchema.safeParse({ message: '', operation: 'start', status: 'pending' }).success).toBe(
      false
    );
  });

  it('rejects extra keys (closed object)', () => {
    expect(
      serviceOperationResultSchema.safeParse({ extra: 1, message: '', operation: 'start', status: 'succeeded' }).success
    ).toBe(false);
  });
});
