import { z } from 'zod';

// the charset whitelist for every value substituted into a command template at
// render time (skill-run.service.ts, phase 4). broad enough to cover docker
// container names, absolute compose paths, and compose project names, yet it
// excludes every shell metacharacter (space, `; | & $` backtick, parens, quotes,
// redirects, globs) — the "constrain the alphabet, not escape the string"
// discipline from container-name.schema.ts. a leading `/` is allowed so absolute
// compose paths (e.g. /volume1/.../docker-compose.yml) pass. each value is
// re-parsed through this at the shell boundary regardless of source (service-
// derived or caller input), so a tainted value never reaches the executor.
export const skillParameterValueSchema = z
  .string()
  .min(1, { error: 'a parameter value is required' })
  .regex(/^[a-zA-Z0-9/][a-zA-Z0-9_.:/=-]*$/, { error: 'a parameter value has invalid characters' });

export type SkillParameterValue = z.infer<typeof skillParameterValueSchema>;
