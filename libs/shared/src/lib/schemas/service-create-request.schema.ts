import { z } from 'zod';

// request body for persisting one curated container as a managed service —
// identity only. the web batch-add issues one create per selected container.
// compose project/path are scan-derived and optional (standalone containers
// carry neither).
export const serviceCreateRequestSchema = z.strictObject({
  composePath: z.string().nullable().optional(),
  composeProject: z.string().nullable().optional(),
  containerName: z.string().min(1, { error: 'containerName is required' }),
  deviceId: z.uuid(),
  name: z.string().min(1, { error: 'name is required' }),
});

export type ServiceCreateRequest = z.infer<typeof serviceCreateRequestSchema>;
