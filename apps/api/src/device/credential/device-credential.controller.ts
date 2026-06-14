import { CurrentUserId } from '@api/common/current-user-id.decorator';
import { ZodValidationPipe } from '@api/common/zod-validation.pipe';
import { deviceConfig, DeviceConfig } from '@api/config/device.config';
import { CredentialService } from '@api/credential/credential.service';
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

@Controller('devices/:deviceId/credentials')
export class DeviceCredentialController {
  constructor(
    @Inject(CredentialService) private readonly credentialService: CredentialService,
    @Inject(deviceConfig.KEY) private readonly config: DeviceConfig
  ) {}

  @Post()
  create(
    @Param('deviceId') deviceId: string,
    @Body(new ZodValidationPipe(credentialCreateRequestSchema)) body: CredentialCreateRequest,
    @CurrentUserId() userId: string
  ): Promise<Credential> {
    // the path param is the source of truth; reject a body that contradicts it.
    if (body.deviceId !== deviceId) {
      throw new BadRequestException('deviceId in body does not match the path');
    }
    return this.credentialService.create(body, userId);
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
  remove(
    @Param('deviceId') deviceId: string,
    @Param('credentialId') credentialId: string,
    @CurrentUserId() userId: string
  ): Promise<void> {
    return this.credentialService.remove(deviceId, credentialId, userId);
  }
}
