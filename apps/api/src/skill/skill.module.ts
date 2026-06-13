import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { json } from 'express';

import { SkillController } from './skill.controller';
import { SkillSeedService } from './skill.seed';
import { SkillService } from './skill.service';

// the crud controller/service land here (phase 3) alongside the boot-time seed
// (phase 2). databasemodule is @global, so the DATABASE_CONNECTION dep resolves
// without an explicit import and the seed's bootstrap hook fires after the
// migration hook. SkillService is exported for the run path (phase 4).
@Module({
  controllers: [SkillController],
  exports: [SkillService],
  providers: [SkillSeedService, SkillService],
})
export class SkillModule implements NestModule {
  configure(middlewareConsumer: MiddlewareConsumer): void {
    // the global body parser is disabled (main.ts: bodyParser false) so better-auth's
    // catch-all node handler receives the raw body; domain routes must re-apply json().
    middlewareConsumer.apply(json()).forRoutes(SkillController);
  }
}
