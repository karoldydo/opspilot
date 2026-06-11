import { diagnosisSynthesisSchema } from './diagnosis-synthesis.schema';

describe('diagnosisSynthesisSchema', () => {
  const valid = {
    problems: ['container restarting every 30s'],
    status: 'degraded' as const,
    suggestions: ['check the database connection string'],
    summary: 'service is up but crash-looping on a bad db url',
  };

  it('parses a valid 4-field synthesis', () => {
    expect(diagnosisSynthesisSchema.parse(valid)).toEqual(valid);
  });

  it('parses empty problems and suggestions lists', () => {
    const healthy = { ...valid, problems: [], status: 'healthy' as const, suggestions: [] };

    expect(diagnosisSynthesisSchema.parse(healthy)).toEqual(healthy);
  });

  it('rejects an unknown key (strict)', () => {
    expect(diagnosisSynthesisSchema.safeParse({ ...valid, logs: 'raw' }).success).toBe(false);
  });

  it('rejects an invalid status literal', () => {
    expect(diagnosisSynthesisSchema.safeParse({ ...valid, status: 'unknown' }).success).toBe(false);
  });

  it('rejects non-string array elements', () => {
    expect(diagnosisSynthesisSchema.safeParse({ ...valid, problems: [42] }).success).toBe(false);
  });
});
