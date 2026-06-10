import { ConfigType, registerAs } from '@nestjs/config';

// llm-domain tunables — the test-call timeout routed through the config layer,
// never a baked-in const (see lessons.md config-tunable rule). joi writes the
// default back to process.env as a string, so coerce with Number(...).
export const llmConfig = registerAs('llm', () => ({
  testTimeoutMs: Number(process.env.LLM_TEST_TIMEOUT_MS),
}));

export type LlmConfig = ConfigType<typeof llmConfig>;
