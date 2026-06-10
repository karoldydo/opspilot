import { llmProviderSchema } from './llm-provider.schema';

describe('llmProviderSchema', () => {
  it('parses a valid provider', () => {
    const valid = {
      active: true,
      baseURL: 'https://api.openai.com/v1',
      createdAt: '2026-06-08T12:00:00.000Z',
      hasApiKey: true,
      id: 'llm_123',
      kind: 'openai-compatible',
      model: 'gpt-4o-mini',
      updatedAt: '2026-06-08T12:00:00.000Z',
    };

    expect(llmProviderSchema.parse(valid)).toEqual(valid);
  });

  it('normalizes a Date timestamp to an iso string', () => {
    const createdAt = new Date('2026-06-08T12:00:00.000Z');
    const updatedAt = new Date('2026-06-09T08:30:00.000Z');

    const parsed = llmProviderSchema.parse({
      active: false,
      baseURL: 'https://api.openai.com/v1',
      createdAt,
      hasApiKey: false,
      id: 'llm_123',
      kind: 'openai-compatible',
      model: 'gpt-4o-mini',
      updatedAt,
    });

    expect(parsed.createdAt).toBe('2026-06-08T12:00:00.000Z');
    expect(parsed.updatedAt).toBe('2026-06-09T08:30:00.000Z');
  });

  it('rejects an unknown kind', () => {
    const result = llmProviderSchema.safeParse({
      active: true,
      baseURL: 'https://api.openai.com/v1',
      createdAt: '2026-06-08T12:00:00.000Z',
      hasApiKey: true,
      id: 'llm_123',
      kind: 'anthropic-native',
      model: 'gpt-4o-mini',
      updatedAt: '2026-06-08T12:00:00.000Z',
    });

    expect(result.success).toBe(false);
  });

  it('rejects a non-url baseURL', () => {
    const result = llmProviderSchema.safeParse({
      active: true,
      baseURL: 'not-a-url',
      createdAt: '2026-06-08T12:00:00.000Z',
      hasApiKey: true,
      id: 'llm_123',
      kind: 'openai-compatible',
      model: 'gpt-4o-mini',
      updatedAt: '2026-06-08T12:00:00.000Z',
    });

    expect(result.success).toBe(false);
  });

  it('rejects a leaked apiKey field (strict)', () => {
    const result = llmProviderSchema.safeParse({
      active: true,
      apiKey: 'sk-super-secret',
      baseURL: 'https://api.openai.com/v1',
      createdAt: '2026-06-08T12:00:00.000Z',
      hasApiKey: true,
      id: 'llm_123',
      kind: 'openai-compatible',
      model: 'gpt-4o-mini',
      updatedAt: '2026-06-08T12:00:00.000Z',
    });

    expect(result.success).toBe(false);
  });

  it('rejects a leaked ciphertext field (strict)', () => {
    const result = llmProviderSchema.safeParse({
      active: true,
      baseURL: 'https://api.openai.com/v1',
      ciphertext: 'AQID',
      createdAt: '2026-06-08T12:00:00.000Z',
      hasApiKey: true,
      id: 'llm_123',
      kind: 'openai-compatible',
      model: 'gpt-4o-mini',
      updatedAt: '2026-06-08T12:00:00.000Z',
    });

    expect(result.success).toBe(false);
  });
});
