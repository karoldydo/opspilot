import { CredentialModule } from '@api/core/credential/credential.module';
import { AuditModule } from '@api/modules/audit/audit.module';
import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { json } from 'express';

import { DeviceCredentialController } from './credential/device-credential.controller';
import { DeviceController } from './device.controller';
import { DeviceService } from './device.service';

@Module({
  controllers: [DeviceController, DeviceCredentialController],
  exports: [DeviceService],
  imports: [AuditModule, CredentialModule],
  providers: [DeviceService],
})
export class DeviceModule implements NestModule {
  configure(middlewareConsumer: MiddlewareConsumer): void {
    // global body parser disabled in main.ts (better-auth raw body); re-apply json() here
    middlewareConsumer.apply(json()).forRoutes(DeviceController, DeviceCredentialController);
  }
}
