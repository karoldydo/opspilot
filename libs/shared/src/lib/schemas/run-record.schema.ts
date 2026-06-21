import { z } from 'zod';

import { diagnosisSynthesisSchema } from './diagnosis-synthesis.schema';

// accepts either a wire-level iso string (raw http/json) or a date the drizzle
// row carries (timestamp_ms decodes to a date), normalizing both to an iso
// string — the render contract stays a string regardless of the source. mirrors
// the boundary pattern in llm-provider.schema.ts.
const isoTimestamp = z.preprocess((value) => (value instanceof Date ? value.toISOString() : value), z.iso.datetime());

// the saved, replayable shape of one diagnose run. the fixed 4-field synthesis is
// nested under metadata so the web can render a replayed run with the current card
// template unchanged. `userId` is deliberately absent here — the db column exists
// (nullable, reserved for s-09) but never crosses the /api boundary in s-05.
export const runRecordSchema = z.strictObject({
  createdAt: isoTimestamp,
  deviceId: z.string(),
  // wall-clock ms the synthesis took to generate. optional/absent on runs predating
  // the durationMs column (s-05 overview); feeds the avg-diagnose tile aggregate.
  durationMs: z.number().int().nonnegative().optional(),
  id: z.string(),
  serviceId: z.string(),
  synthesis: diagnosisSynthesisSchema,
});

export type RunRecord = z.infer<typeof runRecordSchema>;
