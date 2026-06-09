import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';

import { AuthAppGuard } from '../auth/auth.guard';
import { AuthModule } from '../auth/auth.module';
import { ConfigModule } from '../config/config.module';
import { CredentialModule } from '../credential/credential.module';
import { DatabaseModule } from '../database/database.module';
import { HealthModule } from '../health/health.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';

@Module({
  controllers: [AppController],
  imports: [AuthModule, ConfigModule, CredentialModule, DatabaseModule, HealthModule],
  providers: [AppService, { provide: APP_GUARD, useClass: AuthAppGuard }],
})
export class AppModule {}
