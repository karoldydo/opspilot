import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Inject, Param, Patch, Post, Query } from '@nestjs/common';
import {
  Skill,
  SkillCreateRequest,
  skillCreateRequestSchema,
  SkillUpdateRequest,
  skillUpdateRequestSchema,
} from '@opspilot/shared';

import { CurrentUserId } from '../common/current-user-id.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { SkillService } from './skill.service';

@Controller('skills')
export class SkillController {
  constructor(@Inject(SkillService) private readonly skillService: SkillService) {}

  @Post()
  create(
    @Body(new ZodValidationPipe(skillCreateRequestSchema)) body: SkillCreateRequest,
    @CurrentUserId() userId: string
  ): Promise<Skill> {
    return this.skillService.create(body, userId);
  }

  // with ?deviceId= the list is scoped to that device (global + that device's rows) via
  // findForDevice — the per-service run surface uses this so out-of-scope skills never
  // reach the browser. without it, returns every row for the crud management list.
  @Get()
  findAll(@Query('deviceId') deviceId?: string): Promise<Skill[]> {
    return deviceId ? this.skillService.findForDevice(deviceId) : this.skillService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string): Promise<Skill> {
    return this.skillService.findOne(id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(skillUpdateRequestSchema)) body: SkillUpdateRequest,
    @CurrentUserId() userId: string
  ): Promise<Skill> {
    return this.skillService.update(id, body, userId);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string, @CurrentUserId() userId: string): Promise<void> {
    return this.skillService.remove(id, userId);
  }
}
