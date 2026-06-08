import { Controller, Get, HttpStatus, Inject, Res } from '@nestjs/common';
import { HealthResponse } from '@opspilot/shared';
import { Response } from 'express';

import { Public } from '../auth/public.decorator';
import { HealthService } from './health.service';

@Public()
@Controller('health')
export class HealthController {
  constructor(@Inject(HealthService) private readonly healthService: HealthService) {}

  @Get()
  check(@Res({ passthrough: true }) response: Response): HealthResponse {
    const result = this.healthService.check();
    response.status(result.db === 'up' ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);
    return result;
  }
}
