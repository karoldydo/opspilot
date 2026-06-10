import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { type LlmProvider } from '@opspilot/shared';

import { LlmProvidersClient } from '../clients/llm-providers.client';
import { LlmProvidersStore } from './llm-providers.store';

const provider: LlmProvider = {
  active: true,
  baseURL: 'https://api.openai.com/v1',
  createdAt: '2026-06-10T00:00:00.000Z',
  hasApiKey: true,
  id: '33333333-3333-4333-8333-333333333333',
  kind: 'openai-compatible',
  model: 'gpt-4o-mini',
  updatedAt: '2026-06-10T00:00:00.000Z',
};

function apiError(message: string, status: number): HttpErrorResponse {
  return new HttpErrorResponse({ error: { message, status, timestamp: '2026-06-10T00:00:00.000Z' }, status });
}

function setup(client: Partial<LlmProvidersClient>): LlmProvidersStore {
  TestBed.configureTestingModule({
    providers: [{ provide: LlmProvidersClient, useValue: client }, LlmProvidersStore],
  });
  return TestBed.inject(LlmProvidersStore);
}

describe('LlmProvidersStore', () => {
  it('creates a provider then refetches on success', async () => {
    const create = vi.fn().mockResolvedValue(provider);
    const list = vi.fn().mockResolvedValue([provider]);
    const store = setup({ create, list });

    const result = await store.create({
      apiKey: 'sk-secret',
      baseURL: provider.baseURL,
      kind: 'openai-compatible',
      model: provider.model,
    });

    expect(result).toEqual({ error: null });
    expect(create).toHaveBeenCalledOnce();
    // mutate-then-refetch: a successful create reloads the list.
    expect(list).toHaveBeenCalledOnce();
    expect(store.providers()).toEqual([provider]);
  });

  it('surfaces the test-call error and does not refetch when create fails', async () => {
    const create = vi.fn().mockRejectedValue(apiError('llm provider at https://x unreachable', 503));
    const list = vi.fn();
    const store = setup({ create, list });

    const result = await store.create({
      apiKey: 'sk-bad',
      baseURL: 'https://x',
      kind: 'openai-compatible',
      model: 'gpt',
    });

    expect(result).toEqual({ error: 'llm provider at https://x unreachable' });
    // a failed create never refetches — the list stays as it was.
    expect(list).not.toHaveBeenCalled();
    expect(store.providers()).toEqual([]);
  });

  it('activates a provider then refetches so the badge follows the server', async () => {
    const activate = vi.fn().mockResolvedValue(provider);
    const list = vi.fn().mockResolvedValue([provider]);
    const store = setup({ activate, list });

    const result = await store.activate(provider.id);

    expect(result).toEqual({ error: null });
    expect(activate).toHaveBeenCalledWith(provider.id);
    expect(list).toHaveBeenCalledOnce();
  });

  it('removes a provider then refetches on success', async () => {
    const remove = vi.fn().mockResolvedValue(undefined);
    const list = vi.fn().mockResolvedValue([]);
    const store = setup({ list, remove });

    const result = await store.remove(provider.id);

    expect(result).toEqual({ error: null });
    expect(remove).toHaveBeenCalledWith(provider.id);
    expect(list).toHaveBeenCalledOnce();
  });
});
