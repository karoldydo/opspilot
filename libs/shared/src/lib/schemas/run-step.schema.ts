import { z } from 'zod';

// one honest execution milestone the diagnose stream narrates as a terminal line.
// `kind` drives the fe-owned prefix/color map ($/·/+/!/=) — the contract carries only
// kind + text, the design layer owns the styling. `warn` stays in the enum for future
// real warnings (e.g. a degraded ssh retry) even though no honest warn step ships at
// launch. steps are ephemeral: emitted live, never persisted, absent on replay.
export const runStepSchema = z.strictObject({
  kind: z.enum(['cmd', 'sys', 'ok', 'warn', 'result']),
  text: z.string(),
});

export type RunStep = z.infer<typeof runStepSchema>;
