import { Controller, Inject, Param, Post } from '@nestjs/common';
import { DiagnosisSynthesis } from '@opspilot/shared';

import { DiagnoseService } from './diagnose.service';

// thin http boundary nested under the device's service. params only — no body; the
// response is the service's validated DiagnosisSynthesis (mirrors the thin
// llm-provider/service controllers, nestjs.md "keep controllers thin").
@Controller('devices/:deviceId/services/:serviceId')
export class DiagnoseController {
  constructor(@Inject(DiagnoseService) private readonly diagnoseService: DiagnoseService) {}

  @Post('diagnose')
  diagnose(@Param('deviceId') deviceId: string, @Param('serviceId') serviceId: string): Promise<DiagnosisSynthesis> {
    return this.diagnoseService.diagnose(deviceId, serviceId);
  }
}
