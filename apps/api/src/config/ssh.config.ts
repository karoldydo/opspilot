import { ConfigType, registerAs } from '@nestjs/config';

// config-tunable timeouts, not baked-in consts (lessons.md); coerce with Number(...) — joi writes defaults back as strings.
export const sshConfig = registerAs('ssh', () => ({
  commandTimeoutMs: Number(process.env.SSH_COMMAND_TIMEOUT_MS),
  connectTimeoutMs: Number(process.env.SSH_CONNECT_TIMEOUT_MS),
}));

export type SshConfig = ConfigType<typeof sshConfig>;
