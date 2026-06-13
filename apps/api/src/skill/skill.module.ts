import { Module } from '@nestjs/common';

import { SkillSeedService } from './skill.seed';

// phase 2 wires only the boot-time seed; the crud controller/service land in phase 3.
// databasemodule is @global, so the seed's DATABASE_CONNECTION dep resolves without an
// explicit import and its bootstrap hook fires after the migration hook.
@Module({
  providers: [SkillSeedService],
})
export class SkillModule {}
