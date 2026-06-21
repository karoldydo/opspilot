import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { type RunNarrationEvent, runNarrationEventSchema, type RunRecord, runRecordSchema } from '@opspilot/shared';
import { firstValueFrom } from 'rxjs';

// the callbacks a stream caller wires up. `event` receives each parsed domain frame
// (delta/done/error); `transportError` fires on a native EventSource failure — a dropped
// connection or non-200 pre-flight EventSource can't expose. it bypasses HttpClient, so
// a pre-flight failure never trips the 401 session-expiry interceptor.
export interface DiagnosisStreamHandlers {
  event: (event: RunNarrationEvent) => void;
  transportError: () => void;
}

// typed http/sse i/o against the diagnose endpoints, nested under the device/service
// path. params only — no body; the path ids are the only input. the live stream is a
// native EventSource (GET-only), the replay list a plain GET. both responses parse
// through the shared zod contract so a malformed/leaked shape fails at the boundary.
@Injectable()
export class DiagnosisClient {
  private readonly http = inject(HttpClient);

  // recent saved runs for one service row, newest-first, parsed at the boundary
  // (createdAt normalizes to an iso string).
  recentRuns(deviceId: string, serviceId: string): Promise<RunRecord[]> {
    return firstValueFrom(
      this.http.get<unknown[]>(`/api/devices/${deviceId}/services/${serviceId}/diagnose/runs`)
    ).then((rows) => runRecordSchema.array().parse(rows));
  }

  // opens the live narration stream over a native EventSource. each message parses
  // through runNarrationEventSchema so a malformed/leaked frame is dropped at the boundary
  // (the `: ping` heartbeat is an sse comment, never delivered as a message). returns a
  // teardown that close()s the source — the caller invokes it on a terminal frame
  // (done/error) so EventSource auto-reconnect doesn't re-run the diagnosis, and on destroy.
  stream(deviceId: string, serviceId: string, handlers: DiagnosisStreamHandlers): () => void {
    const source = new EventSource(`/api/devices/${deviceId}/services/${serviceId}/diagnose/stream`);
    source.onmessage = (message) => {
      let payload: unknown;
      try {
        payload = JSON.parse(message.data);
      } catch {
        // ignore a non-json frame, don't throw inside the callback.
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
