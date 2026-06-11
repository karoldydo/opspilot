import { z } from 'zod';

// a filesystem path with no shell metacharacters: alphanumerics plus `/ . _ -`.
// composePath is interpolated into a `docker compose -f <path>` shell command over
// ssh, populated raw from docker labels — so this boundary re-parse rejects space,
// `; | & $`, backtick, quotes and redirects, closing the injection class exactly as
// containerNameSchema does. only applied in the op path; serviceSchema stays loose
// so a legitimately-odd scanned path is never lost.
export const composePathSchema = z
  .string()
  .min(1, { error: 'composePath is required' })
  .regex(/^[a-zA-Z0-9/._-]+$/, { error: 'composePath has invalid characters' });

export type ComposePath = z.infer<typeof composePathSchema>;
