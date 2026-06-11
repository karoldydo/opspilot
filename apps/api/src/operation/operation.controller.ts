import { Body, Controller, Inject, Param, Post } from '@nestjs/common';
import { ServiceOperationRequest, serviceOperationRequestSchema, ServiceOperationResult } from '@opspilot/shared';

import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { OperationService } from './operation.service';

// thin http boundary nested under the device's service, mirroring DiagnoseController's
// thinness + ServiceController's ZodValidationPipe body validation. the request body
// is validated against the 5-op enum at the boundary, so a forged operation never
// reaches a command (nestjs.md "keep controllers thin").
@Controller('devices/:deviceId/services/:serviceId')
export class OperationController {
  constructor(@Inject(OperationService) private readonly operationService: OperationService) {}

  @Post('operations')
  run(
    @Param('deviceId') deviceId: string,
    @Param('serviceId') serviceId: string,
    @Body(new ZodValidationPipe(serviceOperationRequestSchema)) body: ServiceOperationRequest
  ): Promise<ServiceOperationResult> {
    return this.operationService.run(deviceId, serviceId, body.operation);
  }
}
