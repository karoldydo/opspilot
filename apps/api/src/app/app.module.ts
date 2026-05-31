import { Module } from '@nestjs/common';

import { ConfigModule } from '../config/config.module';
import { DatabaseModule } from '../database/database.module';
import { HealthModule } from '../health/health.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';

@Module({
  controllers: [AppController],
  imports: [ConfigModule, DatabaseModule, HealthModule],
  providers: [AppService],
})
export class AppModule {}
