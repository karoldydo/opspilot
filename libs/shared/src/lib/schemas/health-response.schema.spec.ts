import { healthResponseSchema } from './health-response.schema';

describe('healthResponseSchema', () => {
  it('parses a valid health response', () => {
    const valid = {
      db: 'up' as const,
      status: 'ok' as const,
      timestamp: '2026-05-31T12:00:00.000Z',
    };

    expect(healthResponseSchema.parse(valid)).toEqual(valid);
  });

  it('rejects an invalid health response', () => {
    const invalid = {
      db: 'maybe',
      status: 'degraded',
      timestamp: '2026-05-31T12:00:00.000Z',
    };

    const result = healthResponseSchema.safeParse(invalid);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.length).toBeGreaterThan(0);
    }
  });
});
