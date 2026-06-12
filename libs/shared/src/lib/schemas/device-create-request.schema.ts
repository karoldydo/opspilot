import { z } from 'zod';

// request body for creating a device — identity only (name + host). ssh
// credentials are captured via the separate /devices/:id/credentials call, so
// no secret material enters here.
export const deviceCreateRequestSchema = z.strictObject({
  // host-level free-text persona for the diagnostic agent; optional/nullable —
  // omitted or null leaves the device without a system instruction.
  agentContext: z.string().max(4000, { error: 'agent context must be 4000 characters or fewer' }).nullable().optional(),
  host: z.string().min(1, { error: 'host is required' }),
  name: z.string().min(1, { error: 'name is required' }),
});

export type DeviceCreateRequest = z.infer<typeof deviceCreateRequestSchema>;
