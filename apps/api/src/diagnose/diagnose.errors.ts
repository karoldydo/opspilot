import { BadGatewayException, GatewayTimeoutException } from '@nestjs/common';

// the synthesis half of the s-04 error taxonomy. the logs-over-ssh half flows
// through the existing executor + docker errors (executor.errors.ts /
// service.errors.ts) and the no-active-provider precondition through
// LlmProviderNoActiveError (409). each extends a distinct http exception so the
// global filter surfaces a legible status without per-controller formatting
// (nestjs.md). deliberately NEVER 401 — a 401 trips the web session-expiry
// interceptor (better-auth.md), mirroring SshAuthError → 502.

// the docker logs fetch exceeded the tight per-command logsTimeoutMs bound before
// the executor returned (504) — distinct from the 30s default ssh command timeout,
// keeps the diagnose run inside the < 15s nfr.
export class DiagnosisLogsTimeoutError extends GatewayTimeoutException {
  constructor(containerName: string, timeoutMs: number) {
    super(`fetching logs for ${containerName} timed out after ${timeoutMs}ms`);
  }
}

// the active provider did not honor json_schema enforcement, so generateText threw
// NoObjectGeneratedError (the silent json_object degrade returns non-conformant
// output). a first-class 502 upstream fault, never a silent malformed 200. carries
// only a safe message — never the raw .text / decrypted keys.
export class DiagnosisSynthesisError extends BadGatewayException {
  constructor() {
    super('active provider did not return schema-conformant output');
  }
}

// the synthesis generation exceeded LLM_GENERATE_TIMEOUT_MS before the provider
// returned (504), mirroring the ssh/probe timeout half of the taxonomy.
export class DiagnosisTimeoutError extends GatewayTimeoutException {
  constructor() {
    super('active llm provider did not return a diagnosis in time');
  }
}
