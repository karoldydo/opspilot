import { z } from 'zod';

// accepts either a wire-level iso string (raw http/json) or a date the drizzle
// row carries (timestamp_ms decodes to a date), normalizing both to an iso
// string — the render contract stays a string regardless of the source.
const isoTimestamp = z.preprocess((value) => (value instanceof Date ? value.toISOString() : value), z.iso.datetime());

// the safe-metadata llm-provider shape the rest of the app may see. secret columns
// (ciphertext/iv/authTag/keyVersion) and the raw apiKey are deliberately omitted —
// they live only on the drizzle row and never cross the /api boundary. the derived
// flags `active` (single-active invariant) and `hasApiKey` (a key is stored) are
// surfaced instead. z.strictObject rejects any leaked secret-bearing key.
export const llmProviderSchema = z.strictObject({
  active: z.boolean(),
  baseURL: z.url(),
  createdAt: isoTimestamp,
  hasApiKey: z.boolean(),
  id: z.string(),
  kind: z.enum(['openai-compatible']),
  model: z.string(),
  updatedAt: isoTimestamp,
});

export type LlmProvider = z.infer<typeof llmProviderSchema>;
