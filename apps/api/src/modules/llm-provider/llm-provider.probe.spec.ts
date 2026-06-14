import { LlmProviderAuthError, LlmProviderTimeoutError, LlmProviderUnreachableError } from './llm-provider.errors';
import { LlmProviderProbe } from './llm-provider.probe';

describe('LlmProviderProbe', () => {
  const baseURL = 'https://api.openai.com/v1';
  const apiKey = 'sk-test';

  let probe: LlmProviderProbe;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // plain class, no DI graph — inject a fake config directly (nestjs-testing.md).
    probe = new LlmProviderProbe({ testTimeoutMs: 5000 });
    mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('resolves on a 200 ok response and hits {baseURL}/models with a bearer token', async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 200 } as Response);

    await expect(probe.verify(baseURL, apiKey)).resolves.toBeUndefined();

    expect(mockFetch).toHaveBeenCalledWith(
      `${baseURL}/models`,
      expect.objectContaining({ headers: { authorization: `Bearer ${apiKey}` } })
    );
  });

  it('strips a trailing slash so the /models path does not double up', async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 200 } as Response);

    await probe.verify(`${baseURL}/`, apiKey);

    expect(mockFetch).toHaveBeenCalledWith(`${baseURL}/models`, expect.anything());
  });

  it('maps a 401 to LlmProviderAuthError (502, not 401)', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 401 } as Response);

    await expect(probe.verify(baseURL, apiKey)).rejects.toThrow(LlmProviderAuthError);
  });

  it('maps a 403 to LlmProviderAuthError', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 403 } as Response);

    await expect(probe.verify(baseURL, apiKey)).rejects.toThrow(LlmProviderAuthError);
  });

  it('maps a non-auth bad status to LlmProviderUnreachableError', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500 } as Response);

    await expect(probe.verify(baseURL, apiKey)).rejects.toThrow(LlmProviderUnreachableError);
  });

  it('maps a network rejection to LlmProviderUnreachableError', async () => {
    mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(probe.verify(baseURL, apiKey)).rejects.toThrow(LlmProviderUnreachableError);
  });

  it('maps an AbortSignal.timeout rejection to LlmProviderTimeoutError', async () => {
    // node names the abort reason 'TimeoutError' when AbortSignal.timeout fires.
    mockFetch.mockRejectedValue(Object.assign(new Error('timed out'), { name: 'TimeoutError' }));

    await expect(probe.verify(baseURL, apiKey)).rejects.toThrow(LlmProviderTimeoutError);
  });
});
