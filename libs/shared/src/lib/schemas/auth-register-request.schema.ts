import { z } from 'zod';

// request body our own register form validates and the better-auth sign-up call receives:
// the login fields plus the display name better-auth requires for email+password sign-up.
export const authRegisterRequestSchema = z.strictObject({
  email: z.email({ error: 'enter a valid email address' }),
  name: z.string().min(1, { error: 'name is required' }).max(128, { error: 'name must be at most 128 characters' }),
  password: z
    .string()
    .min(8, { error: 'password must be at least 8 characters' })
    .max(128, { error: 'password must be at most 128 characters' }),
});

export type AuthRegisterRequest = z.infer<typeof authRegisterRequestSchema>;
