import { z } from 'zod';

// docker compose project-name charset: a leading [a-z0-9] then lowercase
// alphanumerics, underscores, dashes. composeProject is interpolated into a
// `docker compose -p <project>` shell command over ssh, and is populated raw from
// docker labels — so constraining it here closes the command-injection class as a
// boundary re-parse in the op path, mirroring containerNameSchema. the wider
// serviceSchema/scannedContainerSchema stay unconstrained (defense-in-depth only,
// not a retighten of scan/add).
export const composeProjectSchema = z
  .string()
  .min(1, { error: 'composeProject is required' })
  .regex(/^[a-z0-9][a-z0-9_-]*$/, { error: 'composeProject has invalid characters' });

export type ComposeProject = z.infer<typeof composeProjectSchema>;
