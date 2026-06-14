import { CurrentUserId } from '@api/common/decorators/current-user-id.decorator';
import { ZodValidationPipe } from '@api/common/pipes/zod-validation.pipe';
import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Inject, Param, Patch, Post } from '@nestjs/common';
import {
  Device,
  DeviceCreateRequest,
  deviceCreateRequestSchema,
  DeviceUpdateRequest,
  deviceUpdateRequestSchema,
} from '@opspilot/shared';

import { DeviceService } from './device.service';

@Controller('devices')
export class DeviceController {
  constructor(@Inject(DeviceService) private readonly deviceService: DeviceService) {}

  @Post()
  create(
    @Body(new ZodValidationPipe(deviceCreateRequestSchema)) body: DeviceCreateRequest,
    @CurrentUserId() userId: string
  ): Promise<Device> {
    return this.deviceService.create(body, userId);
  }

  @Get()
  findAll(): Promise<Device[]> {
    return this.deviceService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string): Promise<Device> {
    return this.deviceService.findOne(id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(deviceUpdateRequestSchema)) body: DeviceUpdateRequest,
    @CurrentUserId() userId: string
  ): Promise<Device> {
    return this.deviceService.update(id, body, userId);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string, @CurrentUserId() userId: string): Promise<void> {
    return this.deviceService.remove(id, userId);
  }
}
