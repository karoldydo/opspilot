import { z } from 'zod';

import { auditActionSchema } from './audit-log.schema';

// query params for the audit timeline, validated + clamped at the boundary so a
// caller can't request an unbounded page (mirrors credential-list-query.schema.ts).
// optional `action` narrows to one action; `from`/`to` are inclusive iso-datetime
// bounds on createdAt for a time-window filter.
export const auditListQuerySchema = z.strictObject({
  action: auditActionSchema.optional(),
  from: z.iso.datetime().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).default(0),
  to: z.iso.datetime().optional(),
});

export type AuditListQuery = z.infer<typeof auditListQuerySchema>;
