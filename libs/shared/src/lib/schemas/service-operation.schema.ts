import { z } from 'zod';

// the 5 fixed, non-llm lifecycle operations a user runs on a managed service
// (roadmap slice s-06). this enum is the single runtime guardrail — "predefined
// skills only": the controller parses the request against it and the op service
// switches on it, so a forged operation never reaches a command. lowercase
// literals per house convention (diagnosis-synthesis.schema.ts).
export const serviceOperationSchema = z.enum(['start', 'stop', 'restart', 'up', 'down']);

export type ServiceOperation = z.infer<typeof serviceOperationSchema>;

// the ephemeral result envelope the ui renders after one op runs. no id/timestamps —
// nothing is persisted (run-records deferred to s-09). `status: 'failed'` means the
// command ran but exited non-zero for an op-specific reason (e.g. "no such
// container"), distinct from an infra error which surfaces as a 5xx instead.
export const serviceOperationResultSchema = z.strictObject({
  message: z.string(),
  operation: serviceOperationSchema,
  status: z.enum(['succeeded', 'failed']),
});

export type ServiceOperationResult = z.infer<typeof serviceOperationResultSchema>;
