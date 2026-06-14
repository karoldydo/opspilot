import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { type RunNarrationEvent, runNarrationEventSchema, type RunRecord, runRecordSchema } from '@opspilot/shared';
import { firstValueFrom } from 'rxjs';

// the callbacks a stream caller wires up. `event` receives each parsed domain frame
// (delta/done/error); `transportError` fires on a native EventSource failure — a
// dropped connection or a non-200 pre-flight (404/409) whose status/body EventSource
// does not expose. because this bypasses HttpClient, a pre-flight failure never trips
// the 401 session-expiry interceptor.
export interface DiagnosisStreamHandlers {
  event: (event: RunNarrationEvent) => void;
  transportError: () => void;
}

// typed http/sse i/o against the diagnose endpoints, nested under the device/service
// path. params only — no body; the device + service ids in the path are the only
// input. the live stream is consumed over a native EventSource (GET-only); the replay
// list is a plain GET. both responses are parsed through the shared zod contract so a
// malformed/leaked shape fails at the boundary. mirrors services.client.ts.
@Injectable()
export class DiagnosisClient {
  private readonly http = inject(HttpClient);

  // recent saved runs for one service row, newest-first, parsed at the boundary
  // (createdAt normalizes to an iso string). mirrors services.client.ts listServices.
  recentRuns(deviceId: string, serviceId: string): Promise<RunRecord[]> {
    return firstValueFrom(
      this.http.get<unknown[]>(`/api/devices/${deviceId}/services/${serviceId}/diagnose/runs`)
    ).then((rows) => runRecordSchema.array().parse(rows));
  }

  // opens the live narration stream over a native EventSource. each message is parsed
  // through runNarrationEventSchema so a malformed/leaked frame is dropped at the
  // boundary (the `: ping` heartbeat is an sse comment EventSource never delivers as a
  // message). returns a teardown that close()s the source — the caller invokes it on a
  // terminal frame (done/error) so EventSource's built-in auto-reconnect does not
  // re-run the diagnosis, and on destroy.
  stream(deviceId: string, serviceId: string, handlers: DiagnosisStreamHandlers): () => void {
    const source = new EventSource(`/api/devices/${deviceId}/services/${serviceId}/diagnose/stream`);
    source.onmessage = (message) => {
      let payload: unknown;
      try {
        payload = JSON.parse(message.data);
      } catch {
        // ignore a non-json frame rather than throwing inside the callback.
        return;
      }
      const parsed = runNarrationEventSchema.safeParse(payload);
      if (parsed.success) {
        handlers.event(parsed.data);
      }
    };
    source.onerror = () => handlers.transportError();
    return () => source.close();
  }
}
