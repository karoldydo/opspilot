import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Inject, Param, Patch, Post } from '@nestjs/common';
import {
  LlmProvider,
  LlmProviderCreateRequest,
  llmProviderCreateRequestSchema,
  LlmProviderUpdateRequest,
  llmProviderUpdateRequestSchema,
} from '@opspilot/shared';

import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { LlmProviderService } from './llm-provider.service';

@Controller('llm-providers')
export class LlmProviderController {
  constructor(@Inject(LlmProviderService) private readonly llmProviderService: LlmProviderService) {}

  @Post()
  create(
    @Body(new ZodValidationPipe(llmProviderCreateRequestSchema)) body: LlmProviderCreateRequest
  ): Promise<LlmProvider> {
    return this.llmProviderService.create(body);
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
    @Body(new ZodValidationPipe(llmProviderUpdateRequestSchema)) body: LlmProviderUpdateRequest
  ): Promise<LlmProvider> {
    return this.llmProviderService.update(id, body);
  }

  @Patch(':id/activate')
  activate(@Param('id') id: string): Promise<LlmProvider> {
    return this.llmProviderService.activate(id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string): Promise<void> {
    return this.llmProviderService.remove(id);
  }
}
