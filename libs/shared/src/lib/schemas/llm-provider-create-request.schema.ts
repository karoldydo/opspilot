import { z } from 'zod';

// request body for creating an llm provider — the single place the plaintext
// apiKey enters the system. the service test-calls the endpoint, then encrypts
// `apiKey` before storage; this shape must never be reused as the read/response
// contract (which omits the secret entirely — see llm-provider.schema.ts).
// `active` does NOT enter here — auto-active-first is computed by the service and
// later changes happen via a separate activate endpoint.
export const llmProviderCreateRequestSchema = z.strictObject({
  apiKey: z.string().min(1, { error: 'apiKey is required' }),
  baseURL: z.url({ error: 'baseURL must be a valid url' }),
  kind: z.enum(['openai-compatible']).default('openai-compatible'),
  model: z.string().min(1, { error: 'model is required' }),
});

export type LlmProviderCreateRequest = z.infer<typeof llmProviderCreateRequestSchema>;
