import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';

import { ZodValidationPipe } from './zod-validation.pipe';

// prove the pipe passes a valid payload through and throws BadRequestException
// (shaped from error.issues) on an invalid one — coverage from day one even
// though no f-01 route consumes it yet.
describe('ZodValidationPipe', () => {
  const schema = z.strictObject({ name: z.string().min(1) });
  const pipe = new ZodValidationPipe(schema);

  it('returns the parsed value for a valid payload', () => {
    const value = { name: 'opspilot' };

    expect(pipe.transform(value)).toEqual(value);
  });

  it('throws BadRequestException for an invalid payload', () => {
    expect(() => pipe.transform({ name: '' })).toThrow(BadRequestException);
  });
});
