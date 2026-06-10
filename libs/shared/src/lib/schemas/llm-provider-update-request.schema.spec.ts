import { llmProviderUpdateRequestSchema } from './llm-provider-update-request.schema';

describe('llmProviderUpdateRequestSchema', () => {
  it('parses a single-field patch', () => {
    const result = llmProviderUpdateRequestSchema.safeParse({ model: 'gpt-4o' });

    expect(result.success).toBe(true);
  });

  it('parses a key-rotation patch (apiKey present)', () => {
    const result = llmProviderUpdateRequestSchema.safeParse({ apiKey: 'sk-new' });

    expect(result.success).toBe(true);
  });

  it('rejects an empty patch', () => {
    const result = llmProviderUpdateRequestSchema.safeParse({});

    expect(result.success).toBe(false);
  });

  it('rejects an empty apiKey on a present field', () => {
    const result = llmProviderUpdateRequestSchema.safeParse({ apiKey: '' });

    expect(result.success).toBe(false);
  });

  it('rejects an unknown key (strict)', () => {
    const result = llmProviderUpdateRequestSchema.safeParse({ active: true });

    expect(result.success).toBe(false);
  });
});
