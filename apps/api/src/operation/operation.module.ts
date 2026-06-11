import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { json } from 'express';

import { ExecutorModule } from '../executor/executor.module';
import { ServiceModule } from '../service/service.module';
import { OperationController } from './operation.controller';
import { OperationService } from './operation.service';

// the s-06 deterministic-operations domain: joins the service-row lookup
// (ServiceModule for ServiceService) with the executor (ExecutorModule for the
// EXECUTOR token). the operation config namespace comes from the global
// ConfigModule, so no explicit import here.
@Module({
  controllers: [OperationController],
  imports: [ExecutorModule, ServiceModule],
  providers: [OperationService],
})
export class OperationModule implements NestModule {
  configure(middlewareConsumer: MiddlewareConsumer): void {
    // the global body parser is disabled (main.ts: bodyParser false) for better-auth's
    // raw-body catch-all; domain routes must re-apply json() for the POST body.
    middlewareConsumer.apply(json()).forRoutes(OperationController);
  }
}
