import { ServiceUnavailableException } from '@nestjs/common';

// the docker-specific half of the error taxonomy — interpreted from a non-zero
// exit + stderr of the `docker ps` command. the executor-level half (connect /
// auth / timeout) lives in executor.errors.ts and already arrives as a domain
// error. both surface a legible body via the global filter (nestjs.md).

// docker is installed but its daemon is not reachable (stopped / socket down) (503).
export class DockerDaemonDownError extends ServiceUnavailableException {
  constructor(deviceId: string) {
    super(`docker daemon is not running on device ${deviceId}`);
  }
}

// docker binary is absent from the non-interactive PATH (e.g. synology — see
// ssh.md). distinct from a daemon that is installed but not running (503).
export class DockerNotFoundError extends ServiceUnavailableException {
  constructor(deviceId: string) {
    super(`docker is not available on device ${deviceId}`);
  }
}
