import { overviewMetricsSchema } from './overview-metrics.schema';

describe('overviewMetricsSchema', () => {
  it('parses valid overview metrics', () => {
    const valid = {
      avgDiagnoseMs: 11_400,
      skillRuns24h: { count: 23, successRate: 0.96 },
    };

    expect(overviewMetricsSchema.parse(valid)).toEqual(valid);
  });

  it('accepts a null avgDiagnoseMs (no run recorded a duration)', () => {
    const valid = {
      avgDiagnoseMs: null,
      skillRuns24h: { count: 0, successRate: 0 },
    };

    expect(overviewMetricsSchema.parse(valid)).toEqual(valid);
  });

  it('rejects a success rate outside 0..1', () => {
    const result = overviewMetricsSchema.safeParse({
      avgDiagnoseMs: null,
      skillRuns24h: { count: 1, successRate: 1.5 },
    });

    expect(result.success).toBe(false);
  });

  it('rejects a negative skill-run count', () => {
    const result = overviewMetricsSchema.safeParse({
      avgDiagnoseMs: null,
      skillRuns24h: { count: -1, successRate: 0 },
    });

    expect(result.success).toBe(false);
  });
});
