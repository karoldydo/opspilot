import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Inject, Param, Patch, Post } from '@nestjs/common';
import {
  Device,
  DeviceCreateRequest,
  deviceCreateRequestSchema,
  DeviceUpdateRequest,
  deviceUpdateRequestSchema,
} from '@opspilot/shared';

import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { DeviceService } from './device.service';

@Controller('devices')
export class DeviceController {
  constructor(@Inject(DeviceService) private readonly deviceService: DeviceService) {}

  @Post()
  create(@Body(new ZodValidationPipe(deviceCreateRequestSchema)) body: DeviceCreateRequest): Promise<Device> {
    return this.deviceService.create(body);
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
    @Body(new ZodValidationPipe(deviceUpdateRequestSchema)) body: DeviceUpdateRequest
  ): Promise<Device> {
    return this.deviceService.update(id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string): Promise<void> {
    return this.deviceService.remove(id);
  }
}
