import { z } from 'zod';

import { skillCreateRequestSchema } from './skill-create-request.schema';

// request body for editing a skill — a partial of the create shape, requiring at
// least one field so an empty patch is rejected at the boundary. rebuilt via
// z.strictObject(create.shape) rather than create.partial() because zod v4 forbids
// .partial() on a refined object schema (create carries the parity refines). the
// parity/uniqueness invariant is re-validated server-side against the merged row
// (phase 3), since a partial patch may carry only one of commandTemplate/parameters.
export const skillUpdateRequestSchema = z
  .strictObject(skillCreateRequestSchema.shape)
  .partial()
  .refine((value) => Object.keys(value).length > 0, { error: 'at least one field is required' });

export type SkillUpdateRequest = z.infer<typeof skillUpdateRequestSchema>;
