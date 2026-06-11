import { DestroyRef, inject, Injectable } from '@angular/core';
import { patchState, signalState } from '@ngrx/signals';
import { type DiagnosisSynthesis, type RunNarrationEvent, type RunRecord } from '@opspilot/shared';

import { DiagnosisClient } from '../clients/diagnosis.client';

// per-service diagnosis slice rendered by one row's result panel. `partial` holds the
// progressively-filled synthesis while a stream is open (null before it starts and once
// it completes); `result` is the final or replayed synthesis; `runs` is the recent saved
// runs that drive the click-to-replay list. null result + null partial means "not
// diagnosed yet this session".
export interface DiagnosisEntry {
  error: null | string;
  loading: boolean;
  partial: null | Partial<DiagnosisSynthesis>;
  result: DiagnosisSynthesis | null;
  runs: RunRecord[];
}

interface DiagnosisState {
  // keyed by serviceId so diagnosing one row never clobbers another row's panel. the
  // component provides one store per device row, but a device has many service rows
  // sharing that store — the key keeps them isolated.
  entries: Record<string, DiagnosisEntry>;
}

const emptyEntry: DiagnosisEntry = { error: null, loading: false, partial: null, result: null, runs: [] };

// signal-based, per-service diagnosis state. provided at the device-services component
// (not providedIn: 'root') so each device row owns its lifecycle. the app is zoneless —
// the EventSource callbacks don't trigger change detection, so state lives in a
// signalState container mutated through patchState (sse.md / angular.md).
@Injectable()
export class DiagnosisStore {
  private readonly client = inject(DiagnosisClient);
  private readonly destroyRef = inject(DestroyRef);
  private readonly state = signalState<DiagnosisState>({ entries: {} });
  // open-stream teardowns keyed by serviceId — closing the EventSource stops its
  // auto-reconnect (which would re-run the diagnosis) and frees the connection.
  private readonly teardowns = new Map<string, () => void>();

  constructor() {
    // the store is provided at the device-services component, so this fires when the
    // row's section is destroyed — close every open stream (sse.md: never leak one).
    this.destroyRef.onDestroy(() => this.closeAll());
  }

  // the row's current slice; reads the entries signal so the template tracks it.
  // returns a fresh empty entry for an un-diagnosed row rather than undefined.
  entry(serviceId: string): DiagnosisEntry {
    return this.state.entries()[serviceId] ?? emptyEntry;
  }

  // loads the recent saved runs for one row's replay list. non-fatal — a transient
  // read failure leaves the existing runs untouched rather than surfacing in the panel.
  async loadRuns(deviceId: string, serviceId: string): Promise<void> {
    try {
      const runs = await this.client.recentRuns(deviceId, serviceId);
      this.patchEntry(serviceId, { ...this.entry(serviceId), runs });
    } catch {
      // leave the existing runs in place on a transient failure.
    }
  }

  // renders a saved run statically in the same card — no re-stream (frame d5). closes
  // any open stream and clears the in-progress partial/error so the replayed result
  // owns the panel.
  replay(serviceId: string, run: RunRecord): void {
    this.teardown(serviceId);
    this.patchEntry(serviceId, {
      ...this.entry(serviceId),
      error: null,
      loading: false,
      partial: null,
      result: run.synthesis,
    });
  }

  // opens a fresh live stream for one row. resets the panel (keeping the runs list),
  // flips loading on, and patches the keyed entry on each frame — leaving every other
  // row untouched. a terminal frame (done/error) closes the source from handleEvent.
  stream(deviceId: string, serviceId: string): void {
    this.teardown(serviceId);
    this.patchEntry(serviceId, { ...this.entry(serviceId), error: null, loading: true, partial: null, result: null });
    const close = this.client.stream(deviceId, serviceId, {
      event: (event) => this.handleEvent(serviceId, event),
      transportError: () => this.handleTransportError(serviceId),
    });
    this.teardowns.set(serviceId, close);
  }

  private closeAll(): void {
    for (const close of this.teardowns.values()) {
      close();
    }
    this.teardowns.clear();
  }

  // patches one row's slice on each domain frame. delta merges into the partial; done
  // sets the final result, clears the partial, prepends the saved run, and closes the
  // stream so EventSource does not reconnect; error surfaces the code's message.
  private handleEvent(serviceId: string, event: RunNarrationEvent): void {
    const entry = this.entry(serviceId);
    if (event.type === 'delta') {
      this.patchEntry(serviceId, { ...entry, partial: { ...entry.partial, ...event.partial } });
      return;
    }
    if (event.type === 'done') {
      this.patchEntry(serviceId, {
        ...entry,
        error: null,
        loading: false,
        partial: null,
        result: event.run.synthesis,
        runs: [event.run, ...entry.runs],
      });
    } else {
      this.patchEntry(serviceId, { ...entry, error: event.message, loading: false, partial: null });
    }
    this.teardown(serviceId);
  }

  // a native EventSource failure (dropped connection or a non-200 pre-flight — 404/409 —
  // whose status/body EventSource hides). only meaningful while the stream is still
  // open; a failure fired by the server's normal close after a terminal frame is ignored
  // (the source was already torn down). renders a generic legible line, never a 401 /
  // session-expiry redirect (this bypasses HttpClient and its interceptor).
  private handleTransportError(serviceId: string): void {
    const entry = this.entry(serviceId);
    if (!entry.loading) {
      return;
    }
    this.patchEntry(serviceId, { ...entry, error: 'could not diagnose service', loading: false, partial: null });
    this.teardown(serviceId);
  }

  // merges one row's slice into the keyed record, preserving every other key.
  private patchEntry(serviceId: string, entry: DiagnosisEntry): void {
    patchState(this.state, { entries: { ...this.state.entries(), [serviceId]: entry } });
  }

  // closes and forgets one row's open stream, if any.
  private teardown(serviceId: string): void {
    const close = this.teardowns.get(serviceId);
    if (close) {
      close();
      this.teardowns.delete(serviceId);
    }
  }
}
