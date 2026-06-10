import { z } from 'zod';

// request body for editing a managed service — display name only. identity
// fields (containerName/composeProject/composePath) are scan-derived and
// immutable; re-targeting means delete + re-scan. a closed single-field object
// is clearer than a partial+refine of create.
export const serviceUpdateRequestSchema = z.strictObject({
  name: z.string().min(1, { error: 'name is required' }),
});

export type ServiceUpdateRequest = z.infer<typeof serviceUpdateRequestSchema>;
