import { Module } from '@nestjs/common';

import { OverviewController } from './overview.controller';
import { OverviewService } from './overview.service';

// overview tile metrics, aggregated from audit_log + run_record (no new table).
// read-only GET — no body, so no json() middleware re-apply needed (diagnose.module.ts).
@Module({
  controllers: [OverviewController],
  providers: [OverviewService],
})
export class OverviewModule {}
