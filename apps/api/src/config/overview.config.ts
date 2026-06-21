import { ConfigType, registerAs } from '@nestjs/config';

// config-tunable aggregation windows, not baked-in consts (lessons.md); coerce with Number(...) — joi writes defaults back as strings.
export const overviewConfig = registerAs('overview', () => ({
  avgDiagnoseWindowMs: Number(process.env.OVERVIEW_AVG_DIAGNOSE_WINDOW_MS),
  skillRunsWindowMs: Number(process.env.OVERVIEW_SKILL_RUNS_WINDOW_MS),
}));

export type OverviewConfig = ConfigType<typeof overviewConfig>;
