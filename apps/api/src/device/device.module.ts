import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { json } from 'express';

import { CredentialModule } from '../credential/credential.module';
import { DeviceCredentialController } from './credential/device-credential.controller';
import { DeviceController } from './device.controller';
import { DeviceService } from './device.service';

@Module({
  controllers: [DeviceController, DeviceCredentialController],
  imports: [CredentialModule],
  providers: [DeviceService],
})
export class DeviceModule implements NestModule {
  configure(middlewareConsumer: MiddlewareConsumer): void {
    middlewareConsumer.apply(json()).forRoutes(DeviceController, DeviceCredentialController);
  }
}
