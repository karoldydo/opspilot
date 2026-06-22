import { z } from 'zod';

import { diagnosisSynthesisSchema } from './diagnosis-synthesis.schema';
import { runRecordSchema } from './run-record.schema';
import { runStepSchema } from './run-step.schema';

// a partial fill of the fixed 4-field synthesis, as `streamObject().partialObjectStream`
// yields it — every field optional while the model is still producing the object.
// derived from the synthesis field set (never re-keyed by hand) so the two shapes
// cannot drift.
const partialDiagnosisSynthesisSchema = diagnosisSynthesisSchema.partial();

// the discriminated union of frames the diagnose sse stream emits. `delta` carries a
// progressive partial of the synthesis; `done` carries the persisted run the fe
// prepends to its recent list; `error` carries a stable code from the diagnose error
// taxonomy (e.g. logs-timeout, synthesis-failed, timeout, upstream-unavailable). `step`
// carries one honest execution milestone as a terminal line; `progress` is a
// periodically-updating heartbeat carrying elapsed inference time so the fe can render a
// single in-place "analyzing… Xs" line during the long model-inference window. `step` and
// `progress` are ephemeral — emitted live, never persisted, absent on replay. the `: ping`
// keep-alive is an sse comment, not a domain event — it never appears here.
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
  z.strictObject({
    step: runStepSchema,
    type: z.literal('step'),
  }),
  z.strictObject({
    elapsedMs: z.number().int().nonnegative(),
    phase: z.enum(['analyzing']),
    type: z.literal('progress'),
  }),
]);

export type RunNarrationEvent = z.infer<typeof runNarrationEventSchema>;
