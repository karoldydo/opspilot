import { z } from 'zod';

import { deviceCreateRequestSchema } from './device-create-request.schema';

// request body for editing a device — a partial of the create shape (name/host),
// requiring at least one field so an empty patch is rejected at the boundary.
export const deviceUpdateRequestSchema = deviceCreateRequestSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, { error: 'at least one field is required' });

export type DeviceUpdateRequest = z.infer<typeof deviceUpdateRequestSchema>;
