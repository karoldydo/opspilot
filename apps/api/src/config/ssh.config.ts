import { ConfigType, registerAs } from '@nestjs/config';

// ssh-executor tunables — connect/command timeouts routed through the config
// layer, never baked-in consts (see lessons.md config-tunable rule). joi writes
// defaults back to process.env as strings, so coerce numerics with Number(...).
export const sshConfig = registerAs('ssh', () => ({
  commandTimeoutMs: Number(process.env.SSH_COMMAND_TIMEOUT_MS),
  connectTimeoutMs: Number(process.env.SSH_CONNECT_TIMEOUT_MS),
}));

export type SshConfig = ConfigType<typeof sshConfig>;
