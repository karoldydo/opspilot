import {
  BadGatewayException,
  GatewayTimeoutException,
  InternalServerErrorException,
  ServiceUnavailableException,
} from '@nestjs/common';

// executor-level error half (connect / auth / timeout); docker half lives in ServiceService.
// each extends a distinct http exception → the global filter gives a legible status (nestjs.md).

// wraps the raw node:crypto "unable to authenticate data" so a key/ciphertext mismatch
// is legible, not an opaque 500 (discharges the F1 deferred obligation).
export class CredentialDecryptError extends InternalServerErrorException {
  constructor(deviceId: string) {
    super(`stored credential for device ${deviceId} could not be decrypted`);
  }
}

// 502 not 401: a 401 would trip the web session-expiry interceptor (better-auth.md).
export class SshAuthError extends BadGatewayException {
  constructor(host: string) {
    super(`ssh authentication failed for ${host}`);
  }
}

export class SshCommandTimeoutError extends GatewayTimeoutException {
  constructor(timeoutMs: number) {
    super(`ssh command timed out after ${timeoutMs}ms`);
  }
}

export class SshConnectError extends ServiceUnavailableException {
  constructor(host: string) {
    super(`cannot reach ${host} over ssh`);
  }
}
