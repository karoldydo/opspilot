import { ConfigType, registerAs } from '@nestjs/config';

// fallback per-run timeout, config-tunable not a const (lessons.md); a skill row's own timeoutMs overrides it. coerce with Number(...).
export const skillConfig = registerAs('skill', () => ({
  timeoutMs: Number(process.env.SKILL_TIMEOUT_MS),
}));

export type SkillConfig = ConfigType<typeof skillConfig>;
