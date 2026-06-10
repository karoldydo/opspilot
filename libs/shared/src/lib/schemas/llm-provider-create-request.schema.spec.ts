import { llmProviderCreateRequestSchema } from './llm-provider-create-request.schema';

describe('llmProviderCreateRequestSchema', () => {
  it('parses a valid create request and defaults kind', () => {
    const parsed = llmProviderCreateRequestSchema.parse({
      apiKey: 'sk-123',
      baseURL: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
    });

    expect(parsed).toEqual({
      apiKey: 'sk-123',
      baseURL: 'https://api.openai.com/v1',
      kind: 'openai-compatible',
      model: 'gpt-4o-mini',
    });
  });

  it('rejects a missing apiKey', () => {
    const result = llmProviderCreateRequestSchema.safeParse({
      baseURL: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
    });

    expect(result.success).toBe(false);
  });

  it('rejects an empty apiKey', () => {
    const result = llmProviderCreateRequestSchema.safeParse({
      apiKey: '',
      baseURL: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
    });

    expect(result.success).toBe(false);
  });

  it('rejects a non-url baseURL', () => {
    const result = llmProviderCreateRequestSchema.safeParse({
      apiKey: 'sk-123',
      baseURL: 'not-a-url',
      model: 'gpt-4o-mini',
    });

    expect(result.success).toBe(false);
  });

  it('rejects a missing model', () => {
    const result = llmProviderCreateRequestSchema.safeParse({
      apiKey: 'sk-123',
      baseURL: 'https://api.openai.com/v1',
    });

    expect(result.success).toBe(false);
  });

  it('rejects an unknown key (strict)', () => {
    const result = llmProviderCreateRequestSchema.safeParse({
      active: true,
      apiKey: 'sk-123',
      baseURL: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
    });

    expect(result.success).toBe(false);
  });
});
