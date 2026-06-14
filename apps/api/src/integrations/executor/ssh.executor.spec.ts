import { SshConfig } from '@api/config/ssh.config';
import { CredentialService } from '@api/core/credential/credential.service';
import { DeviceService } from '@api/device/device.service';
import { Credential } from '@opspilot/shared';
import { NodeSSH } from 'node-ssh';

import { CredentialDecryptError, SshAuthError, SshCommandTimeoutError, SshConnectError } from './executor.errors';
import { SshExecutor } from './ssh.executor';

const inputDeviceId = 'dev_1';
const inputHost = '10.0.0.1';
const isoNow = '2026-01-01T00:00:00.000Z';

// minimal fake of the node-ssh client surface the executor touches.
interface FakeClient {
  connect: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
  execCommand: ReturnType<typeof vi.fn>;
}

function buildExecutor(opts: {
  client: FakeClient;
  commandTimeoutMs?: number;
  connectTimeoutMs?: number;
  credentials?: Credential[];
  getDecryptedSecret?: ReturnType<typeof vi.fn>;
}) {
  const config: SshConfig = {
    commandTimeoutMs: opts.commandTimeoutMs ?? 1000,
    connectTimeoutMs: opts.connectTimeoutMs ?? 1000,
  };
  const credentialService = {
    getDecryptedSecret: opts.getDecryptedSecret ?? vi.fn().mockResolvedValue('secret'),
    list: vi.fn().mockResolvedValue(opts.credentials ?? [mockCredential()]),
  } as unknown as CredentialService;
  const deviceService = {
    findOne: vi
      .fn()
      .mockResolvedValue({ createdAt: isoNow, host: inputHost, id: inputDeviceId, name: 'host', updatedAt: isoNow }),
  } as unknown as DeviceService;
  const factory = vi.fn(() => opts.client as unknown as NodeSSH);
  const executor = new SshExecutor(config, credentialService, deviceService, factory);
  return { credentialService, deviceService, executor, factory };
}

function mockCredential(overrides: Partial<Credential> = {}): Credential {
  return {
    authType: 'password',
    createdAt: isoNow,
    deviceId: inputDeviceId,
    id: 'cred_1',
    updatedAt: isoNow,
    username: 'ops',
    ...overrides,
  };
}

describe('SshExecutor', () => {
  it('serializes execute calls per device (no interleave)', async () => {
    let concurrent = 0;
    let maxConcurrent = 0;
    const client: FakeClient = {
      connect: vi.fn().mockResolvedValue(undefined),
      dispose: vi.fn(),
      execCommand: vi.fn().mockImplementation(async () => {
        concurrent += 1;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        await new Promise((resolve) => setTimeout(resolve, 20));
        concurrent -= 1;
        return { code: 0, signal: null, stderr: '', stdout: 'ok' };
      }),
    };
    const { executor } = buildExecutor({ client, commandTimeoutMs: 1000 });

    await Promise.all([executor.execute(inputDeviceId, 'a'), executor.execute(inputDeviceId, 'b')]);

    expect(maxConcurrent).toBe(1);
    expect(client.execCommand).toHaveBeenCalledTimes(2);
  });

  it('rejects with the timeout error when the command exceeds the command timeout', async () => {
    const client: FakeClient = {
      connect: vi.fn().mockResolvedValue(undefined),
      dispose: vi.fn(),
      // never resolves — the race must reject via the hand-rolled timer.
      execCommand: vi.fn().mockImplementation(() => new Promise(() => undefined)),
    };
    const { executor } = buildExecutor({ client, commandTimeoutMs: 20 });

    await expect(executor.execute(inputDeviceId, 'sleep 60')).rejects.toBeInstanceOf(SshCommandTimeoutError);
    expect(client.dispose).toHaveBeenCalledTimes(1);
  });

  it('honors a per-call timeout override instead of the configured default', async () => {
    const client: FakeClient = {
      connect: vi.fn().mockResolvedValue(undefined),
      dispose: vi.fn(),
      // never resolves — only the override timer (20ms) can reject within the test window.
      execCommand: vi.fn().mockImplementation(() => new Promise(() => undefined)),
    };
    // default ceiling is high (would not fire here); the call passes a tiny override.
    const { executor } = buildExecutor({ client, commandTimeoutMs: 10000 });

    await expect(executor.execute(inputDeviceId, 'sleep 60', 20)).rejects.toBeInstanceOf(SshCommandTimeoutError);
    expect(client.dispose).toHaveBeenCalledTimes(1);
  });

  it('disposes the connection on the success path', async () => {
    const client: FakeClient = {
      connect: vi.fn().mockResolvedValue(undefined),
      dispose: vi.fn(),
      execCommand: vi.fn().mockResolvedValue({ code: 0, signal: null, stderr: '', stdout: 'hi' }),
    };
    const { executor } = buildExecutor({ client });

    const actual = await executor.execute(inputDeviceId, 'echo hi');

    expect(actual).toEqual({ code: 0, stderr: '', stdout: 'hi' });
    expect(client.dispose).toHaveBeenCalledTimes(1);
  });

  it('disposes the connection on the failure path (connect rejects)', async () => {
    const client: FakeClient = {
      connect: vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED 10.0.0.1:22')),
      dispose: vi.fn(),
      execCommand: vi.fn(),
    };
    const { executor } = buildExecutor({ client });

    await expect(executor.execute(inputDeviceId, 'echo')).rejects.toBeInstanceOf(SshConnectError);
    expect(client.dispose).toHaveBeenCalledTimes(1);
    expect(client.execCommand).not.toHaveBeenCalled();
  });

  it('maps an authentication rejection to the auth error', async () => {
    const client: FakeClient = {
      connect: vi.fn().mockRejectedValue(new Error('All configured authentication methods failed')),
      dispose: vi.fn(),
      execCommand: vi.fn(),
    };
    const { executor } = buildExecutor({ client });

    await expect(executor.execute(inputDeviceId, 'echo')).rejects.toBeInstanceOf(SshAuthError);
  });

  it('wraps a decrypt failure in the domain error and never opens a connection', async () => {
    const client: FakeClient = { connect: vi.fn(), dispose: vi.fn(), execCommand: vi.fn() };
    const getDecryptedSecret = vi.fn().mockRejectedValue(new Error('Unsupported state or unable to authenticate data'));
    const { executor, factory } = buildExecutor({ client, getDecryptedSecret });

    await expect(executor.execute(inputDeviceId, 'echo')).rejects.toBeInstanceOf(CredentialDecryptError);
    expect(factory).not.toHaveBeenCalled();
  });

  it('rejects with a connect error when the device has no stored credential', async () => {
    const client: FakeClient = { connect: vi.fn(), dispose: vi.fn(), execCommand: vi.fn() };
    const { executor, factory } = buildExecutor({ client, credentials: [] });

    await expect(executor.execute(inputDeviceId, 'echo')).rejects.toBeInstanceOf(SshConnectError);
    expect(factory).not.toHaveBeenCalled();
  });

  it('uses privateKey auth for a key credential', async () => {
    const client: FakeClient = {
      connect: vi.fn().mockResolvedValue(undefined),
      dispose: vi.fn(),
      execCommand: vi.fn().mockResolvedValue({ code: 0, signal: null, stderr: '', stdout: '' }),
    };
    const { executor } = buildExecutor({
      client,
      credentials: [mockCredential({ authType: 'key' })],
      getDecryptedSecret: vi.fn().mockResolvedValue('PRIVKEY'),
    });

    await executor.execute(inputDeviceId, 'echo');

    expect(client.connect).toHaveBeenCalledWith(
      expect.objectContaining({ host: inputHost, privateKey: 'PRIVKEY', readyTimeout: 1000, username: 'ops' })
    );
  });
});
