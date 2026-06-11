// the result of one remote command run. mirrors node-ssh's execCommand response,
// trimmed to the fields skills actually consume; code is null when the channel
// closed without an exit status.
export interface ExecResult {
  code: null | number;
  stderr: string;
  stdout: string;
}

// transport-agnostic contract skills depend on instead of node-ssh directly, so
// the transport can be swapped or faked in tests (node-ssh.md). connect → run →
// dispose are encapsulated inside execute per call; callers never manage
// connections.
export interface IExecutor {
  // timeoutMs overrides the per-command timeout for this call only; omitting it
  // keeps the executor's configured default (the 30s SSH_COMMAND_TIMEOUT_MS). a
  // long synchronous op (s-06 `up -d` with image pulls) passes a longer bound so
  // it outlasts the default while scan/fetchLogs keep it.
  execute(deviceId: string, command: string, timeoutMs?: number): Promise<ExecResult>;
}
