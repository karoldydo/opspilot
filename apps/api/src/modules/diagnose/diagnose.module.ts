import { ExecutorModule } from '@api/integrations/executor/executor.module';
import { AuditModule } from '@api/modules/audit/audit.module';
import { DeviceModule } from '@api/modules/device/device.module';
import { LlmProviderModule } from '@api/modules/llm-provider/llm-provider.module';
import { ServiceModule } from '@api/modules/service/service.module';
import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { json } from 'express';

import { DiagnoseController } from './diagnose.controller';
import { DiagnoseService } from './diagnose.service';
import { RunRecordService } from './run-record.service';

// diagnose domain wiring; the llm config namespace comes from the global ConfigModule (no import here)
@Module({
  controllers: [DiagnoseController],
  exports: [RunRecordService],
  imports: [AuditModule, DeviceModule, ExecutorModule, LlmProviderModule, ServiceModule],
  providers: [DiagnoseService, RunRecordService],
})
export class DiagnoseModule implements NestModule {
  configure(middlewareConsumer: MiddlewareConsumer): void {
    // global body parser disabled in main.ts (better-auth raw body); re-apply json() here
    middlewareConsumer.apply(json()).forRoutes(DiagnoseController);
  }
}
