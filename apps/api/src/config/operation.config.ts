import { ConfigType, registerAs } from '@nestjs/config';

// service-operation tunables — the dedicated long op timeout routed through the
// config layer, never a baked-in const (see lessons.md config-tunable rule). joi
// writes the default back to process.env as a string, so coerce with Number(...).
export const operationConfig = registerAs('operation', () => ({
  timeoutMs: Number(process.env.OP_TIMEOUT_MS),
}));

export type OperationConfig = ConfigType<typeof operationConfig>;
