import { BadGatewayException, GatewayTimeoutException, ServiceUnavailableException } from '@nestjs/common';

// the test-call error taxonomy: each extends a distinct http exception so the
// global filter surfaces a legible status without per-controller formatting
// (nestjs.md). deliberately NOT 401 — a 401 would trip the web session-expiry
// interceptor (better-auth.md), mirroring SshAuthError → 502.

// provider rejected our key — an upstream (gateway) auth failure (502), not a 401.
export class LlmProviderAuthError extends BadGatewayException {
  constructor(baseURL: string) {
    super(`provider at ${baseURL} rejected the api key`);
  }
}

// the outbound test-call timed out before the provider responded (504).
export class LlmProviderTimeoutError extends GatewayTimeoutException {
  constructor(baseURL: string) {
    super(`provider at ${baseURL} did not respond in time`);
  }
}

// provider unreachable / connection refused / non-auth bad response — upstream is down (503).
export class LlmProviderUnreachableError extends ServiceUnavailableException {
  constructor(baseURL: string) {
    super(`cannot reach provider at ${baseURL}`);
  }
}
