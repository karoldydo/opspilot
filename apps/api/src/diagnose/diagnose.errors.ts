import { BadGatewayException, GatewayTimeoutException } from '@nestjs/common';
import { NoObjectGeneratedError } from 'ai';

// the synthesis half of the s-04 error taxonomy. the logs-over-ssh half flows
// through the existing executor + docker errors (executor.errors.ts /
// service.errors.ts) and the no-active-provider precondition through
// LlmProviderNoActiveError (409). each extends a distinct http exception so the
// global filter surfaces a legible status without per-controller formatting
// (nestjs.md). deliberately never 401 — a 401 trips the web session-expiry
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

// map a mid-stream diagnose failure to the stable { code, message } carried in the
// sse `error` event — distinct from the pre-flight http status codes (404/409) the
// stream is already past. codes are drawn from the diagnose taxonomy the shared
// run-narration union documents (logs-timeout, timeout, synthesis-failed,
// upstream-unavailable). reuses the same timeout / NoObjectGeneratedError
// classification as the batch path. never surfaces a raw provider .text or a
// decrypted key — only a safe typed message or a generic upstream line. order
// matters: logs-timeout and the abort-timeout branch precede the no-object branch
// (a timeout can arrive wrapped as NoObjectGeneratedError).
export function diagnoseErrorToStreamEvent(error: unknown): { code: string; message: string } {
  if (error instanceof DiagnosisLogsTimeoutError) {
    return { code: 'logs-timeout', message: error.message };
  }
  if (isSynthesisTimeout(error)) {
    return { code: 'timeout', message: 'active llm provider did not return a diagnosis in time' };
  }
  if (error instanceof DiagnosisSynthesisError || NoObjectGeneratedError.isInstance(error)) {
    return { code: 'synthesis-failed', message: 'active provider did not return schema-conformant output' };
  }
  // docker daemon down / not found / generic upstream — a safe, generic line.
  return { code: 'upstream-unavailable', message: 'the diagnosis upstream is unavailable' };
}

// true when the error is an AbortSignal.timeout firing during synthesis — either
// surfaced directly (name TimeoutError/AbortError) or wrapped by the sdk as
// NoObjectGeneratedError with the abort as its cause. used to keep a timeout from
// being mis-classified as a generic synthesis failure.
function isSynthesisTimeout(error: unknown): boolean {
  const name = (error as { name?: string } | null)?.name;
  if (name === 'TimeoutError' || name === 'AbortError') {
    return true;
  }
  if (NoObjectGeneratedError.isInstance(error)) {
    const causeName = (error as { cause?: { name?: string } }).cause?.name;
    return causeName === 'TimeoutError' || causeName === 'AbortError';
  }
  return false;
}
