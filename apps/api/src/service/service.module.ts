import { AuditModule } from '@api/audit/audit.module';
import { ExecutorModule } from '@api/executor/executor.module';
import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { json } from 'express';

import { ServiceController } from './service.controller';
import { ServiceService } from './service.service';

// the services domain: scan (ephemeral, through the executor) + curated-subset
// crud. imports ExecutorModule for the EXECUTOR token; the drizzle connection
// comes from the global DatabaseModule.
@Module({
  controllers: [ServiceController],
  exports: [ServiceService],
  imports: [AuditModule, ExecutorModule],
  providers: [ServiceService],
})
export class ServiceModule implements NestModule {
  configure(middlewareConsumer: MiddlewareConsumer): void {
    // the global body parser is disabled (main.ts: bodyParser false) for better-auth's
    // raw-body catch-all; domain routes must re-apply json().
    middlewareConsumer.apply(json()).forRoutes(ServiceController);
  }
}
