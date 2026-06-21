import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { type LlmProvider } from '@opspilot/shared';

import { LlmProvidersClient } from './llm-providers.client';

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

describe('LlmProvidersClient', () => {
  let client: LlmProvidersClient;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), LlmProvidersClient],
    });
    client = TestBed.inject(LlmProvidersClient);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('parses a provider list at the boundary', async () => {
    const promise = client.list();
    const request = httpMock.expectOne('/api/llm-providers');
    expect(request.request.method).toBe('GET');
    request.flush([provider]);

    const result = await promise;
    expect(result).toEqual([provider]);
  });

  it('rejects a response carrying a leaked secret-bearing key', async () => {
    const promise = client.create({
      apiKey: 'sk-secret',
      baseURL: provider.baseURL,
      kind: 'openai-compatible',
      model: provider.model,
    });
    const request = httpMock.expectOne('/api/llm-providers');
    expect(request.request.method).toBe('POST');
    // a leaked key must fail the strict parse at the boundary.
    request.flush({ ...provider, ciphertext: 'deadbeef' });

    await expect(promise).rejects.toThrow();
  });

  it('activates a provider with an empty body', async () => {
    const promise = client.activate(provider.id);
    const request = httpMock.expectOne(`/api/llm-providers/${provider.id}/activate`);
    expect(request.request.method).toBe('PATCH');
    expect(request.request.body).toEqual({});
    request.flush(provider);

    const result = await promise;
    expect(result).toEqual(provider);
  });
});
