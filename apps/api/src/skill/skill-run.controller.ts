import { Body, Controller, Inject, Param, Post } from '@nestjs/common';
import { SkillRunRequest, skillRunRequestSchema, SkillRunResult } from '@opspilot/shared';

import { CurrentUserId } from '../common/current-user-id.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { SkillRunService } from './skill-run.service';

// thin http boundary nested under the device's service, mirroring the retired
// OperationController. the run body (input-param values only) is validated against
// skillRunRequestSchema at the boundary, so a tainted input value never reaches a
// command (nestjs.md "keep controllers thin"). the skill identity comes from the route,
// the scope check lives in the service.
@Controller('devices/:deviceId/services/:serviceId/skills/:skillId')
export class SkillRunController {
  constructor(@Inject(SkillRunService) private readonly skillRunService: SkillRunService) {}

  @Post('run')
  run(
    @Param('deviceId') deviceId: string,
    @Param('serviceId') serviceId: string,
    @Param('skillId') skillId: string,
    @Body(new ZodValidationPipe(skillRunRequestSchema)) body: SkillRunRequest,
    @CurrentUserId() userId: string
  ): Promise<SkillRunResult> {
    return this.skillRunService.run(deviceId, serviceId, skillId, body.inputs, userId);
  }
}
