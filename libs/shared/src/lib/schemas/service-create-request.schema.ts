import { z } from 'zod';

import { containerNameSchema } from './container-name.schema';

// request body for persisting one curated container as a managed service —
// identity only. the web batch-add issues one create per selected container.
// compose project/path are scan-derived and optional (standalone containers
// carry neither).
export const serviceCreateRequestSchema = z.strictObject({
  composePath: z.string().nullable().optional(),
  composeProject: z.string().nullable().optional(),
  containerName: containerNameSchema,
  deviceId: z.uuid(),
  name: z.string().min(1, { error: 'name is required' }),
});

export type ServiceCreateRequest = z.infer<typeof serviceCreateRequestSchema>;
