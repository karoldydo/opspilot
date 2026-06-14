import { BadRequestException, PipeTransform } from '@nestjs/common';
import { ZodType } from 'zod';

export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly zodType: ZodType) {}

  transform(value: unknown): unknown {
    const result = this.zodType.safeParse(value);
    if (!result.success) {
      throw new BadRequestException(result.error.issues);
    }
    return result.data;
  }
}
