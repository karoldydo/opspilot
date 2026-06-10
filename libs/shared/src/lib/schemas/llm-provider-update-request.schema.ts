import { z } from 'zod';

import { llmProviderCreateRequestSchema } from './llm-provider-create-request.schema';

// request body for editing an llm provider — a partial of the create shape,
// requiring at least one field so an empty patch is rejected at the boundary.
// a present `apiKey` means key rotation; an absent one keeps the stored key
// (the service test-calls the stored key against the effective baseURL).
//
// `kind`'s create-side `.default(...)` is dropped here: a surviving default would
// re-materialize into an empty patch (`{}` → `{ kind }`), defeating the non-empty
// refine and silently overwriting the stored kind on an unrelated field patch.
export const llmProviderUpdateRequestSchema = llmProviderCreateRequestSchema
  .omit({ kind: true })
  .extend({ kind: z.enum(['openai-compatible']) })
  .partial()
  .refine((value) => Object.keys(value).length > 0, { error: 'at least one field is required' });

export type LlmProviderUpdateRequest = z.infer<typeof llmProviderUpdateRequestSchema>;
