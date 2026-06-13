import { HttpErrorResponse } from '@angular/common/http';
import { computed, inject, Injectable } from '@angular/core';
import { patchState, signalState } from '@ngrx/signals';
import { apiErrorSchema, type AuditEvent, type AuditListQuery } from '@opspilot/shared';

import { AuditClient } from '../clients/audit.client';

interface AuditState {
  error: null | string;
  events: AuditEvent[];
  loading: boolean;
  // the row whose detail (saved synthesis) is expanded — in-store selection, no
  // re-fetch, mirroring diagnosis.store.replay. null means every row is collapsed.
  selectedId: null | string;
}

// pulls the user-facing message out of an http failure — the global exception
// filter shapes every error body as apiErrorSchema, so prefer that message and
// fall back to a generic line for transport-level failures (devices.store.ts).
function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof HttpErrorResponse) {
    const parsed = apiErrorSchema.safeParse(error.error);
    if (parsed.success) {
      return parsed.data.message;
    }
  }
  return fallback;
}

// signal-based audit timeline state. provided at the audit route (not
// providedIn: 'root', per angular.md) so the lazy feature owns its lifecycle. the
// app is zoneless — async client callbacks don't trigger change detection, so
// state lives in a signalState container mutated through patchState (@ngrx/signals).
@Injectable()
export class AuditStore {
  private readonly client = inject(AuditClient);
  private readonly state = signalState<AuditState>({ error: null, events: [], loading: false, selectedId: null });

  readonly error = this.state.error;

  readonly events = this.state.events;

  readonly isEmpty = computed(() => !this.state.loading() && this.state.events().length === 0);

  readonly loading = this.state.loading;

  readonly selectedId = this.state.selectedId;

  // hydrates the timeline from the server, newest-first. parses through the shared
  // contract so timestamps normalize and any leaked column fails the strict parse.
  async load(query?: AuditListQuery): Promise<void> {
    patchState(this.state, { error: null, loading: true });
    try {
      const events = await this.client.list(query);
      patchState(this.state, { events, loading: false });
    } catch (error) {
      patchState(this.state, { error: errorMessage(error, 'could not load audit log'), loading: false });
    }
  }

  // toggles the expanded detail for one row — selecting the already-open row
  // collapses it. no re-fetch: run-linked rows already carry their synthesis.
  select(id: string): void {
    patchState(this.state, { selectedId: this.state.selectedId() === id ? null : id });
  }
}
