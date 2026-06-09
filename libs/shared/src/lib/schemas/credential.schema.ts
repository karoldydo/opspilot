import { z } from 'zod';

// accepts either a wire-level iso string (raw http/json) or a date the drizzle
// row carries (timestamp_ms decodes to a date), normalizing both to an iso
// string — the render contract stays a string regardless of the source.
const isoTimestamp = z.preprocess((value) => (value instanceof Date ? value.toISOString() : value), z.iso.datetime());

// the safe-metadata credential shape the rest of the app may see. secret columns
// (ciphertext/iv/authTag/plaintext) and keyVersion are deliberately omitted — they
// live only on the drizzle row and never cross the /api boundary. z.strictObject
// rejects any leaked secret-bearing key.
export const credentialSchema = z.strictObject({
  authType: z.enum(['password', 'key']),
  createdAt: isoTimestamp,
  deviceId: z.string(),
  id: z.string(),
  updatedAt: isoTimestamp,
  username: z.string(),
});

export type Credential = z.infer<typeof credentialSchema>;
