import { z } from 'zod';

import { skillParameterValueSchema } from './skill-parameter-value.schema';

// the run endpoint's body (skill-run.controller, phase 4). carries values ONLY for
// `input`-source parameters, keyed by parameter name; `service`-source parameters
// are resolved server-side from the service row and are never accepted from the
// client (preserving the s-06 guarantee). defaults to `{}` so a skill with no input
// params needs no body. each value is charset-constrained (skillParameterValueSchema)
// — the first of two injection guards, re-applied at the shell boundary before
// substitution.
export const skillRunRequestSchema = z.strictObject({
  inputs: z.record(z.string(), skillParameterValueSchema).default({}),
});

export type SkillRunRequest = z.infer<typeof skillRunRequestSchema>;
