import { z } from 'zod';

// the fixed ephemeral 4-field synthesis the diagnose agent must produce from a
// container's logs (roadmap slice s-04). mirrors the ephemeral scanResultSchema —
// no id/timestamps, validated server-side and parsed at the web boundary, never
// persisted (run-records are deferred to s-09). this single fixed shape is also
// the Output.object schema the llm is forced to emit, so structured-output
// enforcement can be checked against it. status literals are lowercase per house
// convention (health-response.schema.ts); problems/suggestions stay flat string[]
// to keep the structured-output burden low.
export const diagnosisSynthesisSchema = z.strictObject({
  problems: z.string().array(),
  status: z.enum(['healthy', 'degraded', 'down']),
  suggestions: z.string().array(),
  summary: z.string(),
});

export type DiagnosisSynthesis = z.infer<typeof diagnosisSynthesisSchema>;
