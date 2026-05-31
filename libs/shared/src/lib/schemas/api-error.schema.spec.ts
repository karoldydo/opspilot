import { apiErrorSchema } from './api-error.schema';

describe('apiErrorSchema', () => {
  it('parses a valid error envelope', () => {
    const valid = {
      message: 'not found',
      status: 404,
      timestamp: '2026-05-31T12:00:00.000Z',
    };

    expect(apiErrorSchema.parse(valid)).toEqual(valid);
  });

  it('rejects an invalid error envelope', () => {
    const invalid = {
      message: 'not found',
      status: 'oops',
      timestamp: 'not-a-date',
    };

    const result = apiErrorSchema.safeParse(invalid);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.length).toBeGreaterThan(0);
    }
  });
});
