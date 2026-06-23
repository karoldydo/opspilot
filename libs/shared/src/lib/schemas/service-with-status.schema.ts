import { z } from 'zod';

import { diagnosisSynthesisSchema } from './diagnosis-synthesis.schema';
import { serviceSchema } from './service.schema';

// a fleet-read row: the persisted service identity plus the status derived from its
// latest run. status reuses the diagnosis-synthesis enum so the two never drift, and is
// nullable — null is the wire signal for "no runs yet", which the web renders as the
// client-only grey 'unknown' (never green). spreads serviceSchema.shape so the service
// fields stay defined once. z.strictObject rejects any leaked column.
export const serviceWithStatusSchema = z.strictObject({
  ...serviceSchema.shape,
  status: diagnosisSynthesisSchema.shape.status.nullable(),
});

export type ServiceWithStatus = z.infer<typeof serviceWithStatusSchema>;
