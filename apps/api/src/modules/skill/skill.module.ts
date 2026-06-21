import { ExecutorModule } from '@api/integrations/executor/executor.module';
import { AuditModule } from '@api/modules/audit/audit.module';
import { ServiceModule } from '@api/modules/service/service.module';
import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { json } from 'express';

import { SkillRunController } from './skill-run.controller';
import { SkillRunService } from './skill-run.service';
import { SkillController } from './skill.controller';
import { SkillSeedService } from './skill.seed';
import { SkillService } from './skill.service';

// databasemodule is @global so DATABASE_CONNECTION needs no import and the seed's
// bootstrap hook fires after the migration hook; skill config from the global ConfigModule.
@Module({
  controllers: [SkillController, SkillRunController],
  exports: [SkillService],
  imports: [AuditModule, ExecutorModule, ServiceModule],
  providers: [SkillRunService, SkillSeedService, SkillService],
})
export class SkillModule implements NestModule {
  configure(middlewareConsumer: MiddlewareConsumer): void {
    // global body parser disabled in main.ts (better-auth raw body); re-apply json() here
    middlewareConsumer.apply(json()).forRoutes(SkillController, SkillRunController);
  }
}
