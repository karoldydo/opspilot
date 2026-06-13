import { ConfigType, registerAs } from '@nestjs/config';

// skill-execution tunables — the default per-run command timeout routed through the
// config layer, never a baked-in const (lessons.md config-tunable rule). a skill row
// may override it with its own timeoutMs; this namespace holds the fallback. joi writes
// the default back to process.env as a string, so coerce with Number(...). replaces the
// retired operationConfig — the s-06 op path folded into the skill run path.
export const skillConfig = registerAs('skill', () => ({
  timeoutMs: Number(process.env.SKILL_TIMEOUT_MS),
}));

export type SkillConfig = ConfigType<typeof skillConfig>;
