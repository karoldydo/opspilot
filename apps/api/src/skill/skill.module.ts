import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { json } from 'express';

import { AuditModule } from '../audit/audit.module';
import { ExecutorModule } from '../executor/executor.module';
import { ServiceModule } from '../service/service.module';
import { SkillRunController } from './skill-run.controller';
import { SkillRunService } from './skill-run.service';
import { SkillController } from './skill.controller';
import { SkillSeedService } from './skill.seed';
import { SkillService } from './skill.service';

// the crud controller/service (phase 3) and the run controller/service (phase 4) land
// here alongside the boot-time seed (phase 2). databasemodule is @global, so the
// DATABASE_CONNECTION dep resolves without an explicit import and the seed's bootstrap
// hook fires after the migration hook. the run path joins the service-row lookup
// (ServiceModule for ServiceService) with the executor (ExecutorModule for the EXECUTOR
// token); the skill config namespace comes from the global ConfigModule.
@Module({
  controllers: [SkillController, SkillRunController],
  exports: [SkillService],
  imports: [AuditModule, ExecutorModule, ServiceModule],
  providers: [SkillRunService, SkillSeedService, SkillService],
})
export class SkillModule implements NestModule {
  configure(middlewareConsumer: MiddlewareConsumer): void {
    // the global body parser is disabled (main.ts: bodyParser false) so better-auth's
    // catch-all node handler receives the raw body; domain routes must re-apply json().
    middlewareConsumer.apply(json()).forRoutes(SkillController, SkillRunController);
  }
}
