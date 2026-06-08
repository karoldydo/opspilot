import { z } from 'zod';

// request body our own login form validates and the better-auth sign-in call receives.
// password bounds mirror better-auth defaults (min 8, max 128) so the fe rejects before the wire.
export const authLoginRequestSchema = z.strictObject({
  email: z.email({ error: 'enter a valid email address' }),
  password: z
    .string()
    .min(8, { error: 'password must be at least 8 characters' })
    .max(128, { error: 'password must be at most 128 characters' }),
});

export type AuthLoginRequest = z.infer<typeof authLoginRequestSchema>;
