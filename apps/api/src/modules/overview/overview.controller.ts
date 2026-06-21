import { CurrentUserId } from '@api/common/decorators/current-user-id.decorator';
import { Controller, Get, Inject } from '@nestjs/common';
import { OverviewMetrics } from '@opspilot/shared';

import { OverviewService } from './overview.service';

// the overview tile metrics, scoped to the authed user. thin controller — the
// aggregation (24h skill-run window, avg-diagnose window, success-rate) lives in
// the service. guarded by the global AuthAppGuard like every operational endpoint.
@Controller('overview')
export class OverviewController {
  constructor(@Inject(OverviewService) private readonly overviewService: OverviewService) {}

  @Get('metrics')
  metrics(@CurrentUserId() userId: string): OverviewMetrics {
    return this.overviewService.metrics(userId);
  }
}
