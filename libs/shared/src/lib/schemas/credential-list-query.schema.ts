import { z } from 'zod';

// query params for listing a device's credentials, validated + clamped at the
// boundary so a caller can't request an unbounded page. the hard ceiling (100)
// is a fixed safety bound; the default page size is supplied by the device
// config namespace at the controller, so `limit` is optional here.
export const credentialListQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).default(0),
});

export type CredentialListQuery = z.infer<typeof credentialListQuerySchema>;
