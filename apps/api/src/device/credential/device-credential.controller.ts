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
  Post,
  Query,
} from '@nestjs/common';
import {
  Credential,
  CredentialCreateRequest,
  credentialCreateRequestSchema,
  CredentialListQuery,
  credentialListQuerySchema,
} from '@opspilot/shared';

import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { deviceConfig, DeviceConfig } from '../../config/device.config';
import { CredentialService } from '../../credential/credential.service';

@Controller('devices/:deviceId/credentials')
export class DeviceCredentialController {
  constructor(
    @Inject(CredentialService) private readonly credentialService: CredentialService,
    @Inject(deviceConfig.KEY) private readonly config: DeviceConfig
  ) {}

  @Post()
  create(
    @Param('deviceId') deviceId: string,
    @Body(new ZodValidationPipe(credentialCreateRequestSchema)) body: CredentialCreateRequest
  ): Promise<Credential> {
    // the path param is the source of truth; reject a body that contradicts it.
    if (body.deviceId !== deviceId) {
      throw new BadRequestException('deviceId in body does not match the path');
    }
    return this.credentialService.create(body);
  }

  @Get()
  list(
    @Param('deviceId') deviceId: string,
    @Query(new ZodValidationPipe(credentialListQuerySchema)) query: CredentialListQuery
  ): Promise<Credential[]> {
    // the schema clamps the hard ceiling (<=100); the default page size comes
    // from the device config namespace when the caller omits limit.
    const limit = query.limit ?? this.config.credentialListLimit;
    return this.credentialService.list(deviceId, query.offset, limit);
  }

  @Delete(':credentialId')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('credentialId') credentialId: string): Promise<void> {
    return this.credentialService.remove(credentialId);
  }
}
