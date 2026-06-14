import { Provider } from '@nestjs/common';
import { NodeSSH } from 'node-ssh';

// di token + factory for constructing a fresh node-ssh client per execute call.
// the executor depends on the factory, not on `new NodeSSH()` directly, so a spec
// can override this token with a fake transport (the real connection is never
// opened in unit tests).
export const SSH_CLIENT_FACTORY = Symbol('SSH_CLIENT_FACTORY');

export type SshClientFactory = () => NodeSSH;

export const sshClientFactoryProvider: Provider = {
  provide: SSH_CLIENT_FACTORY,
  useValue: (): NodeSSH => new NodeSSH(),
};
