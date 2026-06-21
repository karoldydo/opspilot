import { DestroyRef, inject, Injectable } from '@angular/core';
import { DiagnosisClient } from '@app/features/diagnosis/data/diagnosis.client';
import { patchState, signalState } from '@ngrx/signals';
import { type DiagnosisSynthesis, type RunNarrationEvent, type RunRecord } from '@opspilot/shared';

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
  // keyed by serviceId so diagnosing one row never clobbers another — one store per
  // device row, but many service rows share it, so the key keeps their panels isolated.
  entries: Record<string, DiagnosisEntry>;
}

const emptyEntry: DiagnosisEntry = { error: null, loading: false, partial: null, result: null, runs: [] };

// signal-based, per-service diagnosis state, provided at the device-services component
// (not providedIn: 'root', per angular.md) so each device row owns its lifecycle.
// zoneless — EventSource callbacks don't trigger cd, so state rides a signalState
// container mutated through patchState (sse.md).
@Injectable()
export class DiagnosisStore {
  private readonly client = inject(DiagnosisClient);
  private readonly destroyRef = inject(DestroyRef);
  private readonly state = signalState<DiagnosisState>({ entries: {} });
  // open-stream teardowns keyed by serviceId — closing the EventSource stops its
  // auto-reconnect (which would re-run the diagnosis) and frees the connection.
  private readonly teardowns = new Map<string, () => void>();

  constructor() {
    // store is provided per device-services row; on destroy close every open stream (sse.md: never leak).
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

  // a native EventSource failure (dropped connection or non-200 pre-flight EventSource
  // hides). only meaningful while the stream is open — a failure from the server's normal
  // close after a terminal frame is ignored. renders a generic line, never a 401 redirect
  // (this bypasses HttpClient and its interceptor).
  private handleTransportError(serviceId: string): void {
    const entry = this.entry(serviceId);
    if (!entry.loading) {
      return;
    }
    this.patchEntry(serviceId, { ...entry, error: 'could not diagnose service', loading: false, partial: null });
    this.teardown(serviceId);
  }

  private patchEntry(serviceId: string, entry: DiagnosisEntry): void {
    patchState(this.state, { entries: { ...this.state.entries(), [serviceId]: entry } });
  }

  private teardown(serviceId: string): void {
    const close = this.teardowns.get(serviceId);
    if (close) {
      close();
      this.teardowns.delete(serviceId);
    }
  }
}
