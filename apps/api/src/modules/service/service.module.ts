import { ExecutorModule } from '@api/integrations/executor/executor.module';
import { AuditModule } from '@api/modules/audit/audit.module';
import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { json } from 'express';

import { ServiceController } from './service.controller';
import { ServiceService } from './service.service';

// services domain: scan + crud; drizzle connection comes from the global DatabaseModule
@Module({
  controllers: [ServiceController],
  exports: [ServiceService],
  imports: [AuditModule, ExecutorModule],
  providers: [ServiceService],
})
export class ServiceModule implements NestModule {
  configure(middlewareConsumer: MiddlewareConsumer): void {
    // global body parser disabled in main.ts (better-auth raw body); re-apply json() here
    middlewareConsumer.apply(json()).forRoutes(ServiceController);
  }
}
