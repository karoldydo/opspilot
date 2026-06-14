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

// the s-04 diagnose domain: joins the logs-over-ssh half (ServiceModule for the
// service-row lookup, ExecutorModule for the EXECUTOR token) with the synthesis
// half (LlmProviderModule for the active-provider config + client factory). the llm
// config namespace comes from the global ConfigModule, so no explicit import here.
@Module({
  controllers: [DiagnoseController],
  exports: [RunRecordService],
  imports: [AuditModule, DeviceModule, ExecutorModule, LlmProviderModule, ServiceModule],
  providers: [DiagnoseService, RunRecordService],
})
export class DiagnoseModule implements NestModule {
  configure(middlewareConsumer: MiddlewareConsumer): void {
    // the global body parser is disabled (main.ts: bodyParser false) for better-auth's
    // raw-body catch-all; domain routes must re-apply json().
    middlewareConsumer.apply(json()).forRoutes(DiagnoseController);
  }
}
