import { z } from 'zod';

// accepts either a wire-level iso string (raw http/json) or a date the drizzle
// row carries (timestamp_ms decodes to a date), normalizing both to an iso
// string — the render contract stays a string regardless of the source.
const isoTimestamp = z.preprocess((value) => (value instanceof Date ? value.toISOString() : value), z.iso.datetime());

// the canonical device shape returned to clients. carries no secret material —
// ssh credentials live on the separate credential sub-resource and never ride
// the device contract. z.strictObject rejects any leaked key.
export const deviceSchema = z.strictObject({
  createdAt: isoTimestamp,
  host: z.string(),
  id: z.uuid(),
  name: z.string(),
  updatedAt: isoTimestamp,
});

export type Device = z.infer<typeof deviceSchema>;
