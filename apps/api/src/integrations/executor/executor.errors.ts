import {
  BadGatewayException,
  GatewayTimeoutException,
  InternalServerErrorException,
  ServiceUnavailableException,
} from '@nestjs/common';

// the executor-level half of the error taxonomy (connect / auth / timeout); the
// docker-specific half (not-on-path / daemon-down) lives in ServiceService. each
// extends a distinct http exception so the global filter surfaces a legible
// status + message without per-controller formatting (nestjs.md).

// the stored secret could not be decrypted — wraps the raw node:crypto "unable to
// authenticate data" error so a key/ciphertext mismatch surfaces legibly instead
// of as an opaque 500 (discharges the F1 deferred obligation).
export class CredentialDecryptError extends InternalServerErrorException {
  constructor(deviceId: string) {
    super(`stored credential for device ${deviceId} could not be decrypted`);
  }
}

// device rejected our credentials — an upstream (gateway) auth failure (502), not
// a 401: a 401 would trip the web session-expiry interceptor (better-auth.md).
export class SshAuthError extends BadGatewayException {
  constructor(host: string) {
    super(`ssh authentication failed for ${host}`);
  }
}

// the hand-rolled command timeout fired before the command returned (504).
export class SshCommandTimeoutError extends GatewayTimeoutException {
  constructor(timeoutMs: number) {
    super(`ssh command timed out after ${timeoutMs}ms`);
  }
}

// host unreachable / handshake refused — upstream device is down (503).
export class SshConnectError extends ServiceUnavailableException {
  constructor(host: string) {
    super(`cannot reach ${host} over ssh`);
  }
}
