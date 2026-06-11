import { z } from 'zod';

import { serviceOperationSchema } from './service-operation.schema';

// the request body the operations controller validates: exactly one of the 5
// fixed operations. a closed object so any extra key is rejected at the boundary.
export const serviceOperationRequestSchema = z.strictObject({
  operation: serviceOperationSchema,
});

export type ServiceOperationRequest = z.infer<typeof serviceOperationRequestSchema>;
