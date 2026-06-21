import { HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { SkillRunClient } from '@app/features/services/data/skill-run.client';
import { patchState, signalState } from '@ngrx/signals';
import { apiErrorSchema, type SkillRunRequest, type SkillRunResult } from '@opspilot/shared';

// what the run dialog reads to decide whether to stay open (error) or close (success).
export interface SkillRunActionResult {
  error: null | string;
}

// per-service run slice rendered by one row's action cell. `pending` holds the
// skillId currently running (null when idle) so the run control disables + flips its
// label; `result` is the last run's outcome envelope; `error` is a transport-level
// failure line. null result + null error + null pending means "no skill run yet this
// session". mirrors the retired ServiceOperationEntry, keyed by skillId not an op enum.
export interface SkillRunEntry {
  error: null | string;
  pending: null | string;
  result: null | SkillRunResult;
}

interface SkillRunState {
  // keyed by serviceId so a row's pending/result is isolated. the store is provided
  // per row (at the service-skills component), so in practice the record holds a
  // single key — the keying is defensive and would also hold if the provider were
  // ever hoisted to a shared parent.
  entries: Record<string, SkillRunEntry>;
}

const emptyEntry: SkillRunEntry = { error: null, pending: null, result: null };

// pulls the user-facing message out of an http failure — the global exception filter
// shapes every error body as apiErrorSchema; falls back to a generic transport line.
function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof HttpErrorResponse) {
    const parsed = apiErrorSchema.safeParse(error.error);
    if (parsed.success) {
      return parsed.data.message;
    }
  }
  return fallback;
}

// signal-based, per-service skill-run state, provided at the service-skills component
// (not providedIn: 'root', per angular.md) so each row owns its lifecycle. zoneless —
// async client callbacks don't trigger cd, so state rides a signalState container
// mutated through patchState.
@Injectable()
export class SkillRunStore {
  private readonly client = inject(SkillRunClient);
  private readonly state = signalState<SkillRunState>({ entries: {} });

  // the row's current slice; reads the entries signal so the template tracks it.
  // returns a fresh empty entry for a row with no run yet rather than undefined.
  entry(serviceId: string): SkillRunEntry {
    return this.state.entries()[serviceId] ?? emptyEntry;
  }

  // runs one skill against one service row: flips `pending` to the skillId (which
  // disables the control + shows the running label), calls the client, then patches
  // the result envelope or a transport-error line — clearing `pending` either way.
  // keyed by serviceId so a slow run on one row leaves every other row untouched. also
  // returns the error so the run dialog can stay open and let the user retry.
  async run(
    deviceId: string,
    serviceId: string,
    skillId: string,
    body: SkillRunRequest
  ): Promise<SkillRunActionResult> {
    this.patchEntry(serviceId, { error: null, pending: skillId, result: null });
    try {
      const result = await this.client.run(deviceId, serviceId, skillId, body);
      this.patchEntry(serviceId, { error: null, pending: null, result });
      return { error: null };
    } catch (error) {
      const message = errorMessage(error, 'could not run skill');
      this.patchEntry(serviceId, { error: message, pending: null, result: null });
      return { error: message };
    }
  }

  private patchEntry(serviceId: string, entry: SkillRunEntry): void {
    patchState(this.state, { entries: { ...this.state.entries(), [serviceId]: entry } });
  }
}
