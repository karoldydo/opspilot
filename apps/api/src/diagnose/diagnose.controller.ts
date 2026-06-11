import { Controller, Get, Inject, MessageEvent, Param, Query, Sse } from '@nestjs/common';
import { RunRecord } from '@opspilot/shared';
import { Observable } from 'rxjs';

import { DiagnoseService } from './diagnose.service';

// hard ceiling on the replay list page size, mirroring the credential list's
// <=100 cap — keeps a caller-supplied ?limit from forcing an oversized read.
const MAX_RUNS_LIMIT = 100;

// thin http boundary nested under the device's service. params only — no body; the
// live stream and the replay list both come straight from the service (nestjs.md
// "keep controllers thin"). EventSource is GET-only, so the s-04 @Post('diagnose')
// trigger is replaced by the @Sse GET below.
@Controller('devices/:deviceId/services/:serviceId')
export class DiagnoseController {
  constructor(@Inject(DiagnoseService) private readonly diagnoseService: DiagnoseService) {}

  // the replay list: recent saved runs for this service row, newest-first and
  // paginated. params carry the device + service; optional limit/offset query.
  @Get('diagnose/runs')
  runs(
    @Param('deviceId') deviceId: string,
    @Param('serviceId') serviceId: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string
  ): RunRecord[] {
    const parsedLimit = this.toPositiveInt(limit);
    // cap the page size but leave offset uncapped so deep pagination still works.
    const boundedLimit = parsedLimit === undefined ? undefined : Math.min(parsedLimit, MAX_RUNS_LIMIT);
    return this.diagnoseService.recentRuns(deviceId, serviceId, boundedLimit, this.toPositiveInt(offset));
  }

  // live narration over sse. pass-through to the service observable: the fail-fast
  // pre-flight (404/409) is awaited inside narrate() and throws a real http status
  // before the cold observable is returned, so a missing service/provider never
  // surfaces as an open-then-error stream. nest's SseStream sets the anti-buffer +
  // no-cache headers (X-Accel-Buffering: no, Cache-Control: no-cache) for us (sse.md).
  @Sse('diagnose/stream')
  stream(
    @Param('deviceId') deviceId: string,
    @Param('serviceId') serviceId: string
  ): Promise<Observable<MessageEvent>> {
    return this.diagnoseService.narrate(deviceId, serviceId);
  }

  // coerce an optional query string to a positive integer; undefined/NaN/<=0 fall
  // back to the service defaults (the bounded findRecent limit/offset).
  private toPositiveInt(value?: string): number | undefined {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
  }
}
