import { z } from 'zod';

// canonical error-response envelope every later slice's error filter emits.
// the fe types error bodies against this single shape (see contracts.md).
export const apiErrorSchema = z.strictObject({
  message: z.string(),
  status: z.number().int(),
  timestamp: z.iso.datetime(),
});

export type ApiError = z.infer<typeof apiErrorSchema>;
