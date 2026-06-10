import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';

import { AuthAppGuard } from '../auth/auth.guard';
import { AuthModule } from '../auth/auth.module';
import { AllExceptionsFilter } from '../common/all-exceptions.filter';
import { ConfigModule } from '../config/config.module';
import { CredentialModule } from '../credential/credential.module';
import { DatabaseModule } from '../database/database.module';
import { DeviceModule } from '../device/device.module';
import { HealthModule } from '../health/health.module';
import { LlmProviderModule } from '../llm-provider/llm-provider.module';
import { ServiceModule } from '../service/service.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';

@Module({
  controllers: [AppController],
  imports: [
    AuthModule,
    ConfigModule,
    CredentialModule,
    DatabaseModule,
    DeviceModule,
    HealthModule,
    LlmProviderModule,
    ServiceModule,
  ],
  providers: [
    AppService,
    { provide: APP_GUARD, useClass: AuthAppGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
