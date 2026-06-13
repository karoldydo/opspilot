import { z } from 'zod';

// the ephemeral result envelope the ui renders after one skill run (skill-run
// .service, phase 4). no id/timestamps — nothing is persisted (run-records remain
// deferred to s-09), mirroring serviceOperationResultSchema but without the op enum
// (the skill identity is already known from the run route). `status: 'failed'` means
// the command ran but exited non-zero for a skill-specific reason (e.g. "no such
// container"); an infra error (daemon down, ssh failure) surfaces as a 5xx instead.
export const skillRunResultSchema = z.strictObject({
  message: z.string(),
  status: z.enum(['failed', 'succeeded']),
});

export type SkillRunResult = z.infer<typeof skillRunResultSchema>;
