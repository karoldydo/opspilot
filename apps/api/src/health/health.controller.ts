import { Controller, Get, HttpStatus, Inject, Res } from '@nestjs/common';
import { HealthResponse } from '@opspilot/shared';
import { Response } from 'express';

import { HealthService } from './health.service';

// pass-through controller exposing GET /api/health (global prefix 'api'); all
// readiness logic lives in the service (nestjs.md).
@Controller('health')
export class HealthController {
  // explicit token: vitest transforms with esbuild (no emitDecoratorMetadata),
  // so type-based DI would resolve to undefined — inject the class token directly.
  constructor(@Inject(HealthService) private readonly healthService: HealthService) {}

  @Get()
  // passthrough lets nest still serialize the returned body while we set the
  // status code: 503 when the db ping fails, 200 when it succeeds — the body
  // stays schema-valid either way.
  check(@Res({ passthrough: true }) res: Response): HealthResponse {
    const result = this.healthService.check();
    res.status(result.db === 'up' ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);
    return result;
  }
}
