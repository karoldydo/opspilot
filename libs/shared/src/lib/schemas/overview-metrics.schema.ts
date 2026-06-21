import { z } from 'zod';

// the two overview tiles that have no other backing source (frame.md backing-data
// gaps): skill-runs-in-24h (derived from audit_log) and avg-diagnose-duration
// (derived from the new run_record.durationMs column). everything else on the
// overview screen is built from existing stores, so it stays out of this contract.
//
// `successRate` is a 0..1 fraction (the web formats it as a percent); `avgDiagnoseMs`
// is null when no run in the window recorded a duration (older rows predating the
// durationMs column read as null and are excluded from the average).
export const overviewMetricsSchema = z.strictObject({
  avgDiagnoseMs: z.number().nullable(),
  skillRuns24h: z.strictObject({
    count: z.number().int().nonnegative(),
    successRate: z.number().min(0).max(1),
  }),
});

export type OverviewMetrics = z.infer<typeof overviewMetricsSchema>;
