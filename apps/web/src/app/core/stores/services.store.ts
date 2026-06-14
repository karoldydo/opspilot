import { HttpErrorResponse } from '@angular/common/http';
import { computed, inject, Injectable } from '@angular/core';
import { type DeviceActionResult } from '@app/features/devices/data/devices.store';
import { patchState, signalState } from '@ngrx/signals';
import { apiErrorSchema, type ScannedContainer, type Service } from '@opspilot/shared';

import { ServicesClient } from '../clients/services.client';

interface ServicesState {
  error: null | string;
  loading: boolean;
  // ephemeral host scan result for the curation ui — never persisted, cleared on
  // each fresh scan. null means "no scan run yet this session".
  scan: null | ScannedContainer[];
  services: Service[];
}

// pulls the user-facing message out of an http failure — the global exception
// filter shapes every error body as apiErrorSchema, so prefer that message and
// fall back to a generic line for transport-level failures. mirrors devices.store.
function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof HttpErrorResponse) {
    const parsed = apiErrorSchema.safeParse(error.error);
    if (parsed.success) {
      return parsed.data.message;
    }
  }
  return fallback;
}

// per-device signal state with mutate-then-refetch, mirroring DevicesStore.
// provided at the device-services component (not providedIn: 'root') so each
// device row owns its own store instance and the deviceId passed to every method
// is the single source of truth. the app is zoneless — async client callbacks
// don't trigger change detection, so state lives in a signalState container.
@Injectable()
export class ServicesStore {
  private readonly client = inject(ServicesClient);
  private readonly state = signalState<ServicesState>({ error: null, loading: false, scan: null, services: [] });

  readonly error = this.state.error;

  readonly isEmpty = computed(() => !this.state.loading() && this.state.services().length === 0);

  readonly loading = this.state.loading;

  readonly scan = this.state.scan;

  readonly services = this.state.services;

  // issues one create per selected container. tolerates partial failure — a
  // single duplicate must not sink the rest — so it runs them all, then reports
  // which container names failed and refetches the managed list regardless so the
  // successes show immediately.
  async addSelected(deviceId: string, selected: ScannedContainer[]): Promise<DeviceActionResult> {
    const results = await Promise.allSettled(
      selected.map((container) =>
        this.client.createService(deviceId, {
          composePath: container.composePath,
          composeProject: container.composeProject,
          containerName: container.containerName,
          deviceId,
          name: container.containerName,
        })
      )
    );
    await this.load(deviceId);
    const failed = selected.filter((_, index) => results[index].status === 'rejected').map((c) => c.containerName);
    if (failed.length > 0) {
      return { error: `could not add: ${failed.join(', ')}` };
    }
    return { error: null };
  }

  // hydrates the managed-services list for one device. parses through the shared
  // contract so timestamps normalize and any leaked runtime field fails strict parse.
  async load(deviceId: string): Promise<void> {
    patchState(this.state, { error: null, loading: true });
    try {
      const services = await this.client.listServices(deviceId);
      patchState(this.state, { loading: false, services });
    } catch (error) {
      patchState(this.state, { error: errorMessage(error, 'could not load services'), loading: false });
    }
  }

  async remove(deviceId: string, id: string): Promise<DeviceActionResult> {
    try {
      await this.client.removeService(deviceId, id);
    } catch (error) {
      return { error: errorMessage(error, 'could not delete service') };
    }
    await this.load(deviceId);
    return { error: null };
  }

  async rename(deviceId: string, id: string, name: string): Promise<DeviceActionResult> {
    try {
      await this.client.updateService(deviceId, id, { name });
    } catch (error) {
      return { error: errorMessage(error, 'could not rename service') };
    }
    await this.load(deviceId);
    return { error: null };
  }

  // runs a fresh host scan and populates the ephemeral scan signal for the
  // curation dialog. clears any prior scan first so a failed scan doesn't leave
  // stale containers on screen.
  async runScan(deviceId: string): Promise<DeviceActionResult> {
    patchState(this.state, { error: null, loading: true, scan: null });
    try {
      const result = await this.client.scan(deviceId);
      patchState(this.state, { loading: false, scan: result.containers });
      return { error: null };
    } catch (error) {
      const message = errorMessage(error, 'could not scan device');
      patchState(this.state, { error: message, loading: false });
      return { error: message };
    }
  }
}
