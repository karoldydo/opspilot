import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { Injectable } from '@nestjs/common';
import { LanguageModel } from 'ai';

@Injectable()
export class LlmProviderClientFactory {
  // the load-bearing reliability seam for s-04: build a configured openai-compatible
  // language model from the active provider config with structured-output enforcement
  // turned on. supportsStructuredOutputs: true is the master switch — it forces a real
  // response_format: { type: 'json_schema' } on the wire instead of the silent
  // json_object degrade that makes generateText throw NoObjectGeneratedError after the
  // fact. verified against @ai-sdk/openai-compatible@2.0.x: the flag lives on the
  // factory settings and the constructed chat model re-exposes it as a readonly
  // supportsStructuredOutputs — the smoke test asserts that so a silent flag-name or
  // behavior drift in the installed package fails at test time, not in production.
  create(config: { apiKey: string; baseURL: string; kind: string; model: string }): LanguageModel {
    const provider = createOpenAICompatible({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
      name: config.kind,
      supportsStructuredOutputs: true,
    });
    return provider(config.model);
  }
}
