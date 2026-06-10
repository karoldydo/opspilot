import { Inject, Injectable } from '@nestjs/common';

import { llmConfig, LlmConfig } from '../config/llm.config';
import { LlmProviderAuthError, LlmProviderTimeoutError, LlmProviderUnreachableError } from './llm-provider.errors';

@Injectable()
export class LlmProviderProbe {
  constructor(@Inject(llmConfig.KEY) private readonly config: LlmConfig) {}

  // first outbound http in api: lightweight openai-compatible reachability + auth
  // probe. resolves on a reachable, authenticated provider; throws a domain error
  // otherwise. the caller runs this BEFORE any db mutation (reject-on-fail).
  async verify(baseURL: string, apiKey: string): Promise<void> {
    // strips trailing slash so `${baseURL}/models` doesn't double up.
    const url = `${baseURL.replace(/\/$/, '')}/models`;
    let res: Response;
    try {
      res = await fetch(url, {
        headers: { authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(this.config.testTimeoutMs),
      });
    } catch (e) {
      // name === 'TimeoutError' when AbortSignal.timeout fires; anything else is unreachable.
      throw (e as Error)?.name === 'TimeoutError'
        ? new LlmProviderTimeoutError(baseURL)
        : new LlmProviderUnreachableError(baseURL);
    }
    if (res.status === 401 || res.status === 403) {
      throw new LlmProviderAuthError(baseURL);
    }
    if (!res.ok) {
      throw new LlmProviderUnreachableError(baseURL);
    }
  }
}
