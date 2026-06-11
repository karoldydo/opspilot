import { HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { patchState, signalState } from '@ngrx/signals';
import { apiErrorSchema, type ServiceOperation, type ServiceOperationResult } from '@opspilot/shared';

import { ServiceOperationsClient } from '../clients/service-operations.client';

// per-service op slice rendered by one row's action cell. `pending` holds the op
// currently running (null when idle) so the button disables + flips its label;
// `result` is the last op's outcome envelope; `error` is a transport-level failure
// line. null result + null error + null pending means "no op run yet this session".
export interface ServiceOperationEntry {
  error: null | string;
  pending: null | ServiceOperation;
  result: null | ServiceOperationResult;
}

interface ServiceOperationsState {
  // keyed by serviceId so running an op on one row never clobbers another row's
  // pending/result — the component provides one store per device row, but a device
  // has many service rows sharing that store, and the key keeps them isolated.
  entries: Record<string, ServiceOperationEntry>;
}

const emptyEntry: ServiceOperationEntry = { error: null, pending: null, result: null };

// pulls the user-facing message out of an http failure — the global exception
// filter shapes every error body as apiErrorSchema, so prefer that message and
// fall back to a generic line for transport-level failures. mirrors services.store.
function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof HttpErrorResponse) {
    const parsed = apiErrorSchema.safeParse(error.error);
    if (parsed.success) {
      return parsed.data.message;
    }
  }
  return fallback;
}

// signal-based, per-service op state. provided at the service-operations component
// (not providedIn: 'root', per angular.md) so each row owns its lifecycle. the app
// is zoneless — async client callbacks don't trigger change detection, so state
// lives in a signalState container mutated through patchState. mirrors diagnosis.store.
@Injectable()
export class ServiceOperationsStore {
  private readonly client = inject(ServiceOperationsClient);
  private readonly state = signalState<ServiceOperationsState>({ entries: {} });

  // the row's current slice; reads the entries signal so the template tracks it.
  // returns a fresh empty entry for a row with no op run yet rather than undefined.
  entry(serviceId: string): ServiceOperationEntry {
    return this.state.entries()[serviceId] ?? emptyEntry;
  }

  // runs one op against one row: flips `pending` (which disables the button +
  // shows the running label), calls the client, then patches the result envelope
  // or a transport-error line — clearing `pending` either way. keyed by serviceId
  // so a slow op on one row leaves every other row untouched.
  async run(deviceId: string, serviceId: string, operation: ServiceOperation): Promise<void> {
    this.patchEntry(serviceId, { error: null, pending: operation, result: null });
    try {
      const result = await this.client.run(deviceId, serviceId, operation);
      this.patchEntry(serviceId, { error: null, pending: null, result });
    } catch (error) {
      this.patchEntry(serviceId, {
        error: errorMessage(error, 'could not run operation'),
        pending: null,
        result: null,
      });
    }
  }

  // merges one row's slice into the keyed record, preserving every other key.
  private patchEntry(serviceId: string, entry: ServiceOperationEntry): void {
    patchState(this.state, { entries: { ...this.state.entries(), [serviceId]: entry } });
  }
}
