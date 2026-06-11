import { LlmProviderClientFactory } from './llm-provider.client-factory';

describe('LlmProviderClientFactory', () => {
  const inputConfig = {
    apiKey: 'sk-test',
    baseURL: 'https://api.example.com/v1',
    kind: 'openai-compatible',
    model: 'gpt-4o',
  };

  // the real signal with teeth: createOpenAICompatible re-exposes the factory's
  // supportsStructuredOutputs flag as a readonly property on the constructed chat
  // model. when true the model emits response_format: { type: 'json_schema' }
  // (enforced) instead of the silent json_object degrade that makes generateText
  // throw NoObjectGeneratedError after the fact. this assertion fails loudly if the
  // flag name/behavior drifts in the installed @ai-sdk/openai-compatible, or if
  // someone removes supportsStructuredOutputs: true from the factory. no network.
  it('constructs a model with structured-output enforcement enabled', () => {
    const factory = new LlmProviderClientFactory();

    const actual = factory.create(inputConfig) as unknown as { supportsStructuredOutputs: boolean };

    expect(actual.supportsStructuredOutputs).toBe(true);
  });
});
