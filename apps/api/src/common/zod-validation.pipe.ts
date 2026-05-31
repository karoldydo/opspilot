import { BadRequestException, PipeTransform } from '@nestjs/common';
import { ZodType } from 'zod';

// reusable boundary pipe: validates inbound payloads against a shared zod schema
// exactly once at the boundary (zod.md, contracts.md). no consumer in f-01 —
// staged for f-02's first inbound route. infer the dto type via z.infer at the
// use site.
export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: ZodType) {}

  transform(value: unknown): unknown {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      // shape the message from error.issues (zod.md) — the global exception
      // filter that emits the apiError envelope lands with f-02's error surface.
      throw new BadRequestException(result.error.issues);
    }
    return result.data;
  }
}
