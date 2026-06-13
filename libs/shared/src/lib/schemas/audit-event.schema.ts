import { z } from 'zod';

import { auditActionSchema } from './audit-log.schema';
import { diagnosisSynthesisSchema } from './diagnosis-synthesis.schema';

// accepts either a wire-level iso string (raw http/json) or the date a drizzle
// row carries (timestamp_ms decodes to a date), normalizing both to an iso string
// — mirrors run-record.schema.ts (wire-level-timestamps lesson).
const isoTimestamp = z.preprocess((value) => (value instanceof Date ? value.toISOString() : value), z.iso.datetime());

// one entry in the merged audit timeline. `metadata` is a secret-free json object
// (ids/labels only). `synthesis` is populated solely for run-linked rows via the
// LEFT JOIN to run_record, so it is optional — a plain crud action carries none.
export const auditEventSchema = z.strictObject({
  action: auditActionSchema,
  createdAt: isoTimestamp,
  id: z.string(),
  metadata: z.record(z.string(), z.unknown()).nullable(),
  runRecordId: z.string().nullable(),
  synthesis: diagnosisSynthesisSchema.optional(),
  targetId: z.string().nullable(),
  targetType: z.string().nullable(),
  userId: z.string(),
});

export type AuditEvent = z.infer<typeof auditEventSchema>;
