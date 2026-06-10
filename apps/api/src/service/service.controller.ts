import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import {
  ScanResult,
  Service,
  ServiceCreateRequest,
  serviceCreateRequestSchema,
  ServiceUpdateRequest,
  serviceUpdateRequestSchema,
} from '@opspilot/shared';

import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ServiceService } from './service.service';

// thin http boundary nested under the device. the scan route is a sibling of the
// services collection, so both hang off the shared devices/:deviceId prefix on one
// controller (mirrors DeviceCredentialController).
@Controller('devices/:deviceId')
export class ServiceController {
  constructor(@Inject(ServiceService) private readonly serviceService: ServiceService) {}

  @Post('scan')
  scan(@Param('deviceId') deviceId: string): Promise<ScanResult> {
    return this.serviceService.scan(deviceId);
  }

  @Get('services')
  findAll(@Param('deviceId') deviceId: string): Promise<Service[]> {
    return this.serviceService.findAll(deviceId);
  }

  @Post('services')
  create(
    @Param('deviceId') deviceId: string,
    @Body(new ZodValidationPipe(serviceCreateRequestSchema)) body: ServiceCreateRequest
  ): Promise<Service> {
    // the path param is the source of truth; reject a body that contradicts it.
    if (body.deviceId !== deviceId) {
      throw new BadRequestException('deviceId in body does not match the path');
    }
    return this.serviceService.create(body);
  }

  @Patch('services/:serviceId')
  update(
    @Param('deviceId') deviceId: string,
    @Param('serviceId') serviceId: string,
    @Body(new ZodValidationPipe(serviceUpdateRequestSchema)) body: ServiceUpdateRequest
  ): Promise<Service> {
    return this.serviceService.update(deviceId, serviceId, body);
  }

  @Delete('services/:serviceId')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('deviceId') deviceId: string, @Param('serviceId') serviceId: string): Promise<void> {
    return this.serviceService.remove(deviceId, serviceId);
  }
}
