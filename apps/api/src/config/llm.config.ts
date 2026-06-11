import { ConfigType, registerAs } from '@nestjs/config';

// llm-domain tunables — every timeout/limit routed through the config layer,
// never a baked-in const (see lessons.md config-tunable rule). joi writes the
// defaults back to process.env as strings, so coerce numerics with Number(...).
export const llmConfig = registerAs('llm', () => ({
  // s-04 generation bound passed as generateText's AbortSignal.timeout (~12s).
  generateTimeoutMs: Number(process.env.LLM_GENERATE_TIMEOUT_MS),
  // how many newest diagnose run-records to keep per service (s-05 replay pruning).
  historyRetention: Number(process.env.LLM_DIAGNOSE_HISTORY_RETENTION),
  // how many trailing log lines to fetch + feed the synthesis (docker logs --tail).
  logsTailLines: Number(process.env.LLM_DIAGNOSE_LOGS_TAIL),
  // tight per-command bound on the s-04 logs fetch (~5s) — distinct from the 30s
  // default SSH_COMMAND_TIMEOUT_MS and from the probe's testTimeoutMs.
  logsTimeoutMs: Number(process.env.LLM_DIAGNOSE_LOGS_TIMEOUT_MS),
  testTimeoutMs: Number(process.env.LLM_TEST_TIMEOUT_MS),
}));

export type LlmConfig = ConfigType<typeof llmConfig>;
