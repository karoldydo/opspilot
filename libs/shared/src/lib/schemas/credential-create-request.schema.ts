import { z } from 'zod';

// request body for creating a credential — the single place the plaintext ssh
// secret enters. modeled on auth-login-request.schema.ts. the service encrypts
// `secret` before storage; this shape must never be reused as the read/response
// contract (which omits the secret entirely — see credential.schema.ts).
export const credentialCreateRequestSchema = z.strictObject({
  authType: z.enum(['password', 'key']),
  deviceId: z.string().min(1, { error: 'deviceId is required' }),
  secret: z.string().min(1, { error: 'secret is required' }),
  username: z.string().min(1, { error: 'username is required' }),
});

export type CredentialCreateRequest = z.infer<typeof credentialCreateRequestSchema>;
