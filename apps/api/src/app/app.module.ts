import { AllExceptionsFilter } from '@api/common/filters/all-exceptions.filter';
import { ConfigModule } from '@api/config/config.module';
import { AuthAppGuard } from '@api/core/auth/auth.guard';
import { AuthModule } from '@api/core/auth/auth.module';
import { CredentialModule } from '@api/core/credential/credential.module';
import { DatabaseModule } from '@api/core/database/database.module';
import { HealthModule } from '@api/core/health/health.module';
import { AuditModule } from '@api/modules/audit/audit.module';
import { DeviceModule } from '@api/modules/device/device.module';
import { DiagnoseModule } from '@api/modules/diagnose/diagnose.module';
import { LlmProviderModule } from '@api/modules/llm-provider/llm-provider.module';
import { ServiceModule } from '@api/modules/service/service.module';
import { SkillModule } from '@api/modules/skill/skill.module';
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
