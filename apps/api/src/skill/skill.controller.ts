import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Inject, Param, Patch, Post } from '@nestjs/common';
import {
  Skill,
  SkillCreateRequest,
  skillCreateRequestSchema,
  SkillUpdateRequest,
  skillUpdateRequestSchema,
} from '@opspilot/shared';

import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { SkillService } from './skill.service';

@Controller('skills')
export class SkillController {
  constructor(@Inject(SkillService) private readonly skillService: SkillService) {}

  @Post()
  create(@Body(new ZodValidationPipe(skillCreateRequestSchema)) body: SkillCreateRequest): Promise<Skill> {
    return this.skillService.create(body);
  }

  @Get()
  findAll(): Promise<Skill[]> {
    return this.skillService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string): Promise<Skill> {
    return this.skillService.findOne(id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(skillUpdateRequestSchema)) body: SkillUpdateRequest
  ): Promise<Skill> {
    return this.skillService.update(id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string): Promise<void> {
    return this.skillService.remove(id);
  }
}
