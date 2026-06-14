import { CredentialModule } from '@api/core/credential/credential.module';
import { DeviceModule } from '@api/device/device.module';
import { Module } from '@nestjs/common';

import { EXECUTOR } from './executor.token';
import { sshClientFactoryProvider } from './ssh-client.factory';
import { SshExecutor } from './ssh.executor';

// cross-cutting provider module exporting the executor via its token, so feature
// modules import it and depend on the IExecutor interface (fakeable in tests).
// imports CredentialModule (exports CredentialService) and DeviceModule (exports
// DeviceService) for credential resolution + device-host lookup.
@Module({
  exports: [EXECUTOR],
  imports: [CredentialModule, DeviceModule],
  providers: [sshClientFactoryProvider, { provide: EXECUTOR, useClass: SshExecutor }],
})
export class ExecutorModule {}
