import { z } from 'zod';

// docker's own legal container-name charset: a leading alphanumeric then
// alphanumerics, underscores, dots, dashes. constraining it here closes the
// command-injection class at the contract source-of-truth — containerName is
// interpolated into a `docker logs` shell command over ssh
// (diagnose.service.ts), and docker itself never assigns a name outside this
// set, so no legitimate scan-derived or operator-supplied value is lost.
export const containerNameSchema = z
  .string()
  .min(1, { error: 'containerName is required' })
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/, { error: 'containerName has invalid characters' });
