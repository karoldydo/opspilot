import { z } from 'zod';

// readiness body for /api/health: overall status plus the db-connection signal.
// status reflects readiness ('ok' when db is 'up', 'error' when db is 'down')
// so a probe can act on it.
export const healthResponseSchema = z.strictObject({
  db: z.enum(['up', 'down']),
  status: z.enum(['ok', 'error']),
  timestamp: z.iso.datetime(),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
