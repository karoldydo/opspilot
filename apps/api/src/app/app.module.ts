import { AuditModule } from '@api/audit/audit.module';
import { AuthAppGuard } from '@api/auth/auth.guard';
import { AuthModule } from '@api/auth/auth.module';
import { AllExceptionsFilter } from '@api/common/all-exceptions.filter';
import { ConfigModule } from '@api/config/config.module';
import { CredentialModule } from '@api/credential/credential.module';
import { DatabaseModule } from '@api/database/database.module';
import { DeviceModule } from '@api/device/device.module';
import { DiagnoseModule } from '@api/diagnose/diagnose.module';
import { HealthModule } from '@api/health/health.module';
import { LlmProviderModule } from '@api/llm-provider/llm-provider.module';
import { ServiceModule } from '@api/service/service.module';
import { SkillModule } from '@api/skill/skill.module';
import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';

import { AppController } from './app.controller';
import { AppService } from './app.service';

@Module({
  controllers: [AppController],
  imports: [
    AuditModule,
    AuthModule,
    ConfigModule,
    CredentialModule,
    DatabaseModule,
    DeviceModule,
    DiagnoseModule,
    HealthModule,
    LlmProviderModule,
    ServiceModule,
    SkillModule,
  ],
  providers: [
    AppService,
    { provide: APP_GUARD, useClass: AuthAppGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
