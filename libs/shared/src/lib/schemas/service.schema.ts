import { z } from 'zod';

import { containerNameSchema } from './container-name.schema';

// accepts either a wire-level iso string (raw http/json) or a date the drizzle
// row carries (timestamp_ms decodes to a date), normalizing both to an iso
// string — the render contract stays a string regardless of the source.
const isoTimestamp = z.preprocess((value) => (value instanceof Date ? value.toISOString() : value), z.iso.datetime());

// the canonical persisted service shape returned to clients — stable identity
// only, no runtime facts (image/status/ports go stale and live only on the
// ephemeral scan result). compose project/path are scan-derived and nullable for
// standalone containers. z.strictObject rejects any leaked column.
export const serviceSchema = z.strictObject({
  composePath: z.string().nullable(),
  composeProject: z.string().nullable(),
  containerName: containerNameSchema,
  createdAt: isoTimestamp,
  deviceId: z.uuid(),
  id: z.uuid(),
  name: z.string(),
  updatedAt: isoTimestamp,
});

export type Service = z.infer<typeof serviceSchema>;
