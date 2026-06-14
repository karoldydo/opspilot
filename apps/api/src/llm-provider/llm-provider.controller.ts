import { CurrentUserId } from '@api/common/decorators/current-user-id.decorator';
import { ZodValidationPipe } from '@api/common/pipes/zod-validation.pipe';
import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Inject, Param, Patch, Post } from '@nestjs/common';
import {
  LlmProvider,
  LlmProviderCreateRequest,
  llmProviderCreateRequestSchema,
  LlmProviderUpdateRequest,
  llmProviderUpdateRequestSchema,
} from '@opspilot/shared';

import { LlmProviderService } from './llm-provider.service';

@Controller('llm-providers')
export class LlmProviderController {
  constructor(@Inject(LlmProviderService) private readonly llmProviderService: LlmProviderService) {}

  @Post()
  create(
    @Body(new ZodValidationPipe(llmProviderCreateRequestSchema)) body: LlmProviderCreateRequest,
    @CurrentUserId() userId: string
  ): Promise<LlmProvider> {
    return this.llmProviderService.create(body, userId);
  }

  @Get()
  findAll(): Promise<LlmProvider[]> {
    return this.llmProviderService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string): Promise<LlmProvider> {
    return this.llmProviderService.findOne(id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(llmProviderUpdateRequestSchema)) body: LlmProviderUpdateRequest,
    @CurrentUserId() userId: string
  ): Promise<LlmProvider> {
    return this.llmProviderService.update(id, body, userId);
  }

  @Patch(':id/activate')
  activate(@Param('id') id: string, @CurrentUserId() userId: string): Promise<LlmProvider> {
    return this.llmProviderService.activate(id, userId);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string, @CurrentUserId() userId: string): Promise<void> {
    return this.llmProviderService.remove(id, userId);
  }
}
