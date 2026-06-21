import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { type RunNarrationEvent, type RunRecord } from '@opspilot/shared';

import { DiagnosisClient, type DiagnosisStreamHandlers } from './diagnosis.client';

const deviceId = '11111111-1111-4111-8111-111111111111';
const serviceId = '22222222-2222-4222-8222-222222222222';

const run: RunRecord = {
  createdAt: '2026-06-11T00:00:00.000Z',
  deviceId,
  id: '33333333-3333-4333-8333-333333333333',
  serviceId,
  synthesis: {
    problems: ['container restarted 3 times in the last hour'],
    status: 'degraded',
    suggestions: ['inspect the crash logs'],
    summary: 'the service is flapping under memory pressure',
  },
};

// minimal EventSource stand-in (jsdom has none) — captures the url + handlers so a test can drive frames and assert close().
class FakeEventSource {
  static instances: FakeEventSource[] = [];
  readonly close = vi.fn();
  onerror: (() => void) | null = null;
  onmessage: ((message: { data: string }) => void) | null = null;

  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }
}

describe('DiagnosisClient', () => {
  let client: DiagnosisClient;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), DiagnosisClient],
    });
    client = TestBed.inject(DiagnosisClient);
    httpMock = TestBed.inject(HttpTestingController);
    FakeEventSource.instances = [];
    vi.stubGlobal('EventSource', FakeEventSource);
  });

  afterEach(() => {
    httpMock.verify();
    vi.unstubAllGlobals();
  });

  describe('recentRuns', () => {
    it('gets the runs path and parses each record at the boundary', async () => {
      const promise = client.recentRuns(deviceId, serviceId);
      const request = httpMock.expectOne(`/api/devices/${deviceId}/services/${serviceId}/diagnose/runs`);
      expect(request.request.method).toBe('GET');
      request.flush([run]);

      const result = await promise;
      expect(result).toEqual([run]);
    });

    it('rejects a record carrying an unknown key', async () => {
      const promise = client.recentRuns(deviceId, serviceId);
      const request = httpMock.expectOne(`/api/devices/${deviceId}/services/${serviceId}/diagnose/runs`);
      // a leaked key must fail the strict parse at the boundary.
      request.flush([{ ...run, userId: 'should-not-be-here' }]);

      await expect(promise).rejects.toThrow();
    });
  });

  describe('stream', () => {
    function handlers(): {
      close: () => void;
      event: ReturnType<typeof vi.fn>;
      transportError: ReturnType<typeof vi.fn>;
    } {
      const event = vi.fn();
      const transportError = vi.fn();
      const close = client.stream(deviceId, serviceId, { event, transportError } satisfies DiagnosisStreamHandlers);
      return { close, event, transportError };
    }

    it('opens an EventSource at the stream path', () => {
      handlers();
      expect(FakeEventSource.instances).toHaveLength(1);
      expect(FakeEventSource.instances[0].url).toBe(`/api/devices/${deviceId}/services/${serviceId}/diagnose/stream`);
    });

    it('parses each message and dispatches the domain frame', () => {
      const { event } = handlers();
      const frame: RunNarrationEvent = { partial: { summary: 'looking…' }, type: 'delta' };
      FakeEventSource.instances[0].onmessage?.({ data: JSON.stringify(frame) });

      expect(event).toHaveBeenCalledWith(frame);
    });

    it('drops a malformed frame instead of throwing', () => {
      const { event } = handlers();
      FakeEventSource.instances[0].onmessage?.({ data: '{not json' });
      FakeEventSource.instances[0].onmessage?.({ data: JSON.stringify({ type: 'unknown' }) });

      expect(event).not.toHaveBeenCalled();
    });

    it('reports a transport error', () => {
      const { transportError } = handlers();
      FakeEventSource.instances[0].onerror?.();

      expect(transportError).toHaveBeenCalled();
    });

    it('returns a teardown that closes the source', () => {
      const { close } = handlers();
      close();

      expect(FakeEventSource.instances[0].close).toHaveBeenCalled();
    });
  });
});
