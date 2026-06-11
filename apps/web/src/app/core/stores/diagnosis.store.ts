import { HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { patchState, signalState } from '@ngrx/signals';
import { apiErrorSchema, type DiagnosisSynthesis } from '@opspilot/shared';

import { DiagnosisClient } from '../clients/diagnosis.client';

// normalized result the diagnose action returns: a user-facing message on failure,
// null on success — mirrors DeviceActionResult / LlmProviderActionResult.
export interface DiagnosisActionResult {
  error: null | string;
}

// per-service diagnosis slice rendered by one row's result panel. null result
// means "not diagnosed yet this session".
export interface DiagnosisEntry {
  error: null | string;
  loading: boolean;
  result: DiagnosisSynthesis | null;
}

interface DiagnosisState {
  // keyed by serviceId so diagnosing one row never clobbers another row's panel.
  // the component provides one store per device row, but a device has many service
  // rows sharing that store — the key keeps them isolated.
  entries: Record<string, DiagnosisEntry>;
}

const emptyEntry: DiagnosisEntry = { error: null, loading: false, result: null };

// pulls the user-facing message out of an http failure — the global exception
// filter shapes every error body as apiErrorSchema, so prefer that message and
// fall back to a generic line for transport-level failures. the synthesis domain
// errors (502/503/504) arrive shaped this way too, so a no-active-provider /
// schema-not-enforced / timeout reaches the panel as a legible line. mirrors
// services.store.
function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof HttpErrorResponse) {
    const parsed = apiErrorSchema.safeParse(error.error);
    if (parsed.success) {
      return parsed.data.message;
    }
  }
  return fallback;
}

// signal-based, per-service diagnosis state. provided at the device-services
// component (not providedIn: 'root') so each device row owns its lifecycle. the
// app is zoneless — async client callbacks don't trigger change detection, so
// state lives in a signalState container mutated through patchState.
@Injectable()
export class DiagnosisStore {
  private readonly client = inject(DiagnosisClient);
  private readonly state = signalState<DiagnosisState>({ entries: {} });

  // the row's current slice; reads the entries signal so the template tracks it.
  // returns a fresh empty entry for an un-diagnosed row rather than undefined.
  entry(serviceId: string): DiagnosisEntry {
    return this.state.entries()[serviceId] ?? emptyEntry;
  }

  // runs a fresh diagnosis for one service row. flips that row's loading on, then
  // replaces its slice with the synthesis or the domain-error message — leaving
  // every other row's slice untouched. re-running re-diagnoses fresh (ephemeral).
  async diagnose(deviceId: string, serviceId: string): Promise<DiagnosisActionResult> {
    this.patchEntry(serviceId, { error: null, loading: true, result: null });
    try {
      const result = await this.client.diagnose(deviceId, serviceId);
      this.patchEntry(serviceId, { error: null, loading: false, result });
      return { error: null };
    } catch (error) {
      const message = errorMessage(error, 'could not diagnose service');
      this.patchEntry(serviceId, { error: message, loading: false, result: null });
      return { error: message };
    }
  }

  // merges one row's slice into the keyed record, preserving every other key.
  private patchEntry(serviceId: string, entry: DiagnosisEntry): void {
    patchState(this.state, { entries: { ...this.state.entries(), [serviceId]: entry } });
  }
}
