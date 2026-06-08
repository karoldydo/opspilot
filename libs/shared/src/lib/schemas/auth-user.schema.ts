import { z } from 'zod';

// accepts either a wire-level iso string (raw http/json) or a date the better-auth
// client hands back (it deserializes timestamps to date objects), normalizing both to
// an iso string — the render contract stays a string regardless of the source.
const isoTimestamp = z.preprocess((value) => (value instanceof Date ? value.toISOString() : value), z.iso.datetime());

// the authenticated user shape the fe renders, owned by us as the render contract.
// derived from what better-auth returns for the session user.
export const authUserSchema = z.strictObject({
  createdAt: isoTimestamp,
  email: z.email(),
  emailVerified: z.boolean(),
  id: z.string(),
  image: z.string().nullable(),
  name: z.string(),
  updatedAt: isoTimestamp,
});

export type AuthUser = z.infer<typeof authUserSchema>;
