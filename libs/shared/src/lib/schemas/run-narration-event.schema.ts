import { z } from 'zod';

import { diagnosisSynthesisSchema } from './diagnosis-synthesis.schema';
import { runRecordSchema } from './run-record.schema';

// a partial fill of the fixed 4-field synthesis, as `streamObject().partialObjectStream`
// yields it — every field optional while the model is still producing the object.
// derived from the synthesis field set (never re-keyed by hand) so the two shapes
// cannot drift.
const partialDiagnosisSynthesisSchema = diagnosisSynthesisSchema.partial();

// the discriminated union of frames the diagnose sse stream emits. `delta` carries a
// progressive partial of the synthesis; `done` carries the persisted run the fe
// prepends to its recent list; `error` carries a stable code from the diagnose error
// taxonomy (e.g. logs-timeout, synthesis-failed, timeout, upstream-unavailable). the
// `: ping` heartbeat is an sse comment, not a domain event — it never appears here.
export const runNarrationEventSchema = z.discriminatedUnion('type', [
  z.strictObject({
    partial: partialDiagnosisSynthesisSchema,
    type: z.literal('delta'),
  }),
  z.strictObject({
    run: runRecordSchema,
    type: z.literal('done'),
  }),
  z.strictObject({
    code: z.string(),
    message: z.string(),
    type: z.literal('error'),
  }),
]);

export type RunNarrationEvent = z.infer<typeof runNarrationEventSchema>;
