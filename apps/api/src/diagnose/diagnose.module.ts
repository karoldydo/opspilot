import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { json } from 'express';

import { ExecutorModule } from '../executor/executor.module';
import { LlmProviderModule } from '../llm-provider/llm-provider.module';
import { ServiceModule } from '../service/service.module';
import { DiagnoseController } from './diagnose.controller';
import { DiagnoseService } from './diagnose.service';

// the s-04 diagnose domain: joins the logs-over-ssh half (ServiceModule for the
// service-row lookup, ExecutorModule for the EXECUTOR token) with the synthesis
// half (LlmProviderModule for the active-provider config + client factory). the llm
// config namespace comes from the global ConfigModule, so no explicit import here.
@Module({
  controllers: [DiagnoseController],
  imports: [ExecutorModule, LlmProviderModule, ServiceModule],
  providers: [DiagnoseService],
})
export class DiagnoseModule implements NestModule {
  configure(middlewareConsumer: MiddlewareConsumer): void {
    // the global body parser is disabled (main.ts: bodyParser false) for better-auth's
    // raw-body catch-all; domain routes must re-apply json().
    middlewareConsumer.apply(json()).forRoutes(DiagnoseController);
  }
}
