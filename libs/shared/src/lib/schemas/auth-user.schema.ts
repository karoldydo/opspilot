import { z } from 'zod';

// the authenticated user shape the fe renders, owned by us as the render contract.
// derived from what better-auth returns for the session user; timestamps cross the wire
// as iso strings (json has no date type), so they are typed as iso datetime here.
export const authUserSchema = z.strictObject({
  createdAt: z.iso.datetime(),
  email: z.email(),
  emailVerified: z.boolean(),
  id: z.string(),
  image: z.string().nullable(),
  name: z.string(),
  updatedAt: z.iso.datetime(),
});

export type AuthUser = z.infer<typeof authUserSchema>;
