import { ConfigType, registerAs } from '@nestjs/config';

// config-tunable timeouts/limits, not baked-in consts (lessons.md); coerce with Number(...) — joi writes defaults back as strings.
export const llmConfig = registerAs('llm', () => ({
  generateTimeoutMs: Number(process.env.LLM_GENERATE_TIMEOUT_MS),
  historyRetention: Number(process.env.LLM_DIAGNOSE_HISTORY_RETENTION),
  logsTailLines: Number(process.env.LLM_DIAGNOSE_LOGS_TAIL),
  // per-command bound on the logs fetch — distinct from SSH_COMMAND_TIMEOUT_MS and testTimeoutMs.
  logsTimeoutMs: Number(process.env.LLM_DIAGNOSE_LOGS_TIMEOUT_MS),
  // cadence of the progress heartbeat that fills the inference dead-air window.
  narrationTickMs: Number(process.env.LLM_NARRATION_TICK_MS),
  testTimeoutMs: Number(process.env.LLM_TEST_TIMEOUT_MS),
}));

export type LlmConfig = ConfigType<typeof llmConfig>;
