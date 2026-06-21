import { sshConfig, SshConfig } from '@api/config/ssh.config';
import { CredentialService } from '@api/core/credential/credential.service';
import { DeviceService } from '@api/modules/device/device.service';
import { Inject, Injectable } from '@nestjs/common';
import { Credential } from '@opspilot/shared';
import { Mutex } from 'async-mutex';
import { Config } from 'node-ssh';

import { CredentialDecryptError, SshAuthError, SshCommandTimeoutError, SshConnectError } from './executor.errors';
import { ExecResult, IExecutor } from './executor.interface';
import { SSH_CLIENT_FACTORY, SshClientFactory } from './ssh-client.factory';

// node-ssh-backed executor: generic ssh only, no docker knowledge here (that is
// ServiceService's half of the taxonomy).
@Injectable()
export class SshExecutor implements IExecutor {
  // one mutex per device serializes its ssh work; different devices run in parallel (node-ssh.md).
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

  private async run(deviceId: string, command: string, timeoutMs?: number): Promise<ExecResult> {
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

      // per-call override falls back to the configured default: scan/fetchLogs keep the 30s
      // ceiling while a long skill run passes SKILL_TIMEOUT_MS.
      const commandTimeoutMs = timeoutMs ?? this.config.commandTimeoutMs;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new SshCommandTimeoutError(commandTimeoutMs)), commandTimeoutMs);
      });
      const result = await Promise.race([ssh.execCommand(command), timeout]);
      return { code: result.code, stderr: result.stderr, stdout: result.stdout };
    } finally {
      // clear the timer (no leaked pending timeout) and dispose unconditionally — the "no run hangs" nfr.
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      // swallow dispose errors: on a failed connect, dispose runs on an unconnected client
      // and must not mask the original connect error.
      try {
        ssh.dispose();
      } catch {
        // intentionally ignored
      }
    }
  }

  // pick the device's credential; with none stored there is nothing to authenticate
  // with, so connect cannot proceed (surfaced as a connect error).
  private async resolveCredential(deviceId: string): Promise<Credential> {
    const credentials = await this.credentialService.list(deviceId);
    const credential = credentials[0];
    if (!credential) {
      throw new SshConnectError(`device ${deviceId} (no stored credential)`);
    }
    return credential;
  }

  // wrap the raw node:crypto "unable to authenticate data" failure in a domain error
  // so a key/ciphertext mismatch is legible (F1 deferred obligation).
  private async decryptSecret(deviceId: string, credential: Credential): Promise<string> {
    try {
      return await this.credentialService.getDecryptedSecret(credential.id);
    } catch {
      throw new CredentialDecryptError(deviceId);
    }
  }

  // distinguish auth rejection from an unreachable host by inspecting the ssh2
  // rejection (auth failures name authentication).
  private mapConnectError(host: string, error: unknown): SshAuthError | SshConnectError {
    const message = error instanceof Error ? error.message : String(error);
    const level = (error as { level?: string })?.level;
    if (level === 'client-authentication' || /authentication/i.test(message)) {
      return new SshAuthError(host);
    }
    return new SshConnectError(host);
  }

  private mutexFor(deviceId: string): Mutex {
    // get-or-create is race-free: no await between get and set, so node's loop never
    // interleaves — concurrent executes on one device share the mutex. map grows one
    // entry per device id, unbounded but tiny at homelab scale.
    let mutex = this.mutexes.get(deviceId);
    if (!mutex) {
      mutex = new Mutex();
      this.mutexes.set(deviceId, mutex);
    }
    return mutex;
  }
}
