import { Inject, Injectable } from '@nestjs/common';
import { Credential } from '@opspilot/shared';
import { Mutex } from 'async-mutex';
import { Config } from 'node-ssh';

import { sshConfig, SshConfig } from '../config/ssh.config';
import { CredentialService } from '../credential/credential.service';
import { DeviceService } from '../device/device.service';
import { CredentialDecryptError, SshAuthError, SshCommandTimeoutError, SshConnectError } from './executor.errors';
import { ExecResult, IExecutor } from './executor.interface';
import { SSH_CLIENT_FACTORY, SshClientFactory } from './ssh-client.factory';

// node-ssh-backed executor. each execute resolves the device's credential,
// connects with auth + connect timeout, runs the command under a per-device mutex
// with a hand-rolled command timeout, and always disposes. generic ssh only — no
// docker knowledge lives here (that is ServiceService's half of the taxonomy).
@Injectable()
export class SshExecutor implements IExecutor {
  // one mutex per device serializes that device's ssh work; different devices run
  // in parallel (node-ssh.md per-device concurrency).
  private readonly mutexes = new Map<string, Mutex>();

  constructor(
    @Inject(sshConfig.KEY) private readonly config: SshConfig,
    @Inject(CredentialService) private readonly credentialService: CredentialService,
    @Inject(DeviceService) private readonly deviceService: DeviceService,
    @Inject(SSH_CLIENT_FACTORY) private readonly createClient: SshClientFactory
  ) {}

  execute(deviceId: string, command: string, timeoutMs?: number): Promise<ExecResult> {
    return this.mutexFor(deviceId).runExclusive(() => this.run(deviceId, command, timeoutMs));
  }

  // resolve credential → connect → race the command against the timeout → dispose.
  private async run(deviceId: string, command: string, timeoutMs?: number): Promise<ExecResult> {
    // findOne throws a 404 if the device is gone; it also carries the host.
    const device = await this.deviceService.findOne(deviceId);
    const credential = await this.resolveCredential(deviceId);
    const secret = await this.decryptSecret(deviceId, credential);

    const ssh = this.createClient();
    let timer: NodeJS.Timeout | undefined;
    try {
      try {
        // accepted risk: no hostVerifier/hostHash, so node-ssh trusts any host key on first
        // contact. opspilot is a homelab tool talking to devices on a trusted lan, so tofu key
        // pinning is deliberately out of scope here — see .claude/rules/node-ssh.md "host keys".
        await ssh.connect({
          host: device.host,
          readyTimeout: this.config.connectTimeoutMs,
          username: credential.username,
          ...(credential.authType === 'password' ? { password: secret } : { privateKey: secret }),
        } satisfies Config);
      } catch (error) {
        throw this.mapConnectError(device.host, error);
      }

      // per-call override falls back to the configured default, so existing callers
      // (scan/fetchLogs) keep the 30s ceiling while a long op passes OP_TIMEOUT_MS.
      const commandTimeoutMs = timeoutMs ?? this.config.commandTimeoutMs;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new SshCommandTimeoutError(commandTimeoutMs)), commandTimeoutMs);
      });
      const result = await Promise.race([ssh.execCommand(command), timeout]);
      return { code: result.code, stderr: result.stderr, stdout: result.stdout };
    } finally {
      // clear the timer so a fast command never leaks a pending timeout, and
      // dispose unconditionally — the "no run hangs" nfr is born here.
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      // swallow dispose errors: when connect() threw, dispose runs on an unconnected client and
      // must not mask the original mapped connect error.
      try {
        ssh.dispose();
      } catch {
        // intentionally ignored
      }
    }
  }

  // pick the device's credential; with no stored credential there is nothing to
  // authenticate with, so the connect cannot proceed (surfaced as a connect error).
  private async resolveCredential(deviceId: string): Promise<Credential> {
    const credentials = await this.credentialService.list(deviceId);
    const credential = credentials[0];
    if (!credential) {
      throw new SshConnectError(`device ${deviceId} (no stored credential)`);
    }
    return credential;
  }

  // wrap the raw node:crypto "unable to authenticate data" failure in a domain
  // error so a key/ciphertext mismatch is legible (F1 deferred obligation).
  private async decryptSecret(deviceId: string, credential: Credential): Promise<string> {
    try {
      return await this.credentialService.getDecryptedSecret(credential.id);
    } catch {
      throw new CredentialDecryptError(deviceId);
    }
  }

  // distinguish a device rejecting our credentials from an unreachable host by
  // inspecting the ssh2 rejection (auth failures name authentication).
  private mapConnectError(host: string, error: unknown): SshAuthError | SshConnectError {
    const message = error instanceof Error ? error.message : String(error);
    const level = (error as { level?: string })?.level;
    if (level === 'client-authentication' || /authentication/i.test(message)) {
      return new SshAuthError(host);
    }
    return new SshConnectError(host);
  }

  private mutexFor(deviceId: string): Mutex {
    // get-or-create is race-free: node's single-threaded loop never interleaves another call
    // between this get and set (no await in between), so two concurrent executes on one device
    // share the same mutex. the map grows one entry per device id ever seen — unbounded but tiny
    // at homelab scale; add eviction only if device churn ever becomes real.
    let mutex = this.mutexes.get(deviceId);
    if (!mutex) {
      mutex = new Mutex();
      this.mutexes.set(deviceId, mutex);
    }
    return mutex;
  }
}
