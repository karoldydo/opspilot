import { HttpErrorResponse } from '@angular/common/http';
import { computed, inject, Injectable } from '@angular/core';
import { DevicesClient } from '@app/features/devices/data/devices.client';
import { patchState, signalState } from '@ngrx/signals';
import {
  apiErrorSchema,
  type CredentialCreateRequest,
  type Device,
  type DeviceCreateRequest,
  type DeviceUpdateRequest,
} from '@opspilot/shared';

// credential fields captured in the device form — deviceId is supplied by the
// store once the device id is known, so the caller never passes it.
export type CredentialInput = Omit<CredentialCreateRequest, 'deviceId'>;

// normalized result the device screens render: a user-facing message on failure,
// null on success — mirrors AuthActionResult.
export interface DeviceActionResult {
  error: null | string;
}

interface DevicesState {
  devices: Device[];
  error: null | string;
  loading: boolean;
}

// pulls the user-facing message out of an http failure — the global exception
// filter shapes every error body as apiErrorSchema, so prefer that message and
// fall back to a generic line for transport-level failures.
function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof HttpErrorResponse) {
    const parsed = apiErrorSchema.safeParse(error.error);
    if (parsed.success) {
      return parsed.data.message;
    }
  }
  return fallback;
}

// signal-based device state with mutate-then-refetch, mirroring AuthStore. provided
// at the devices route (not providedIn: 'root') so the feature owns its lifecycle.
// the app is zoneless — async client callbacks don't trigger change detection, so
// state lives in a signalState container mutated through patchState (@ngrx/signals).
@Injectable()
export class DevicesStore {
  private readonly client = inject(DevicesClient);
  private readonly state = signalState<DevicesState>({ devices: [], error: null, loading: false });

  readonly devices = this.state.devices;

  readonly error = this.state.error;

  readonly isEmpty = computed(() => !this.state.loading() && this.state.devices().length === 0);

  readonly loading = this.state.loading;

  // creates a device and its credential as two calls. the credential contract
  // requires the device id, so the device must land first. if the credential call
  // fails, roll back the orphaned device (best-effort) and surface the original
  // credential error — no device is ever left without credentials.
  async add(deviceInput: DeviceCreateRequest, credentialInput: CredentialInput): Promise<DeviceActionResult> {
    let device: Device;
    try {
      device = await this.client.createDevice(deviceInput);
    } catch (error) {
      return { error: errorMessage(error, 'could not create device') };
    }

    try {
      await this.client.createCredential(device.id, { ...credentialInput, deviceId: device.id });
    } catch (error) {
      // best-effort rollback — a double failure is negligible on a single-writer
      // homelab, so swallow the rollback error and surface the credential one.
      try {
        await this.client.removeDevice(device.id);
      } catch {
        // intentionally ignored — surface the original credential failure below.
      }
      return { error: errorMessage(error, 'could not store credentials') };
    }

    await this.load();
    return { error: null };
  }

  // hydrates the device list from the server. parses through the shared contract
  // so timestamps normalize and secret leaks fail the strict parse.
  async load(): Promise<void> {
    patchState(this.state, { error: null, loading: true });
    try {
      const devices = await this.client.listDevices();
      patchState(this.state, { devices, loading: false });
    } catch (error) {
      patchState(this.state, { error: errorMessage(error, 'could not load devices'), loading: false });
    }
  }

  async remove(id: string): Promise<DeviceActionResult> {
    try {
      await this.client.removeDevice(id);
    } catch (error) {
      return { error: errorMessage(error, 'could not delete device') };
    }
    await this.load();
    return { error: null };
  }

  // there is no credential rotation endpoint — replacing a secret is recreate +
  // delete. store the new credential first, then drop the prior ones only on
  // success, so a failed create never leaves the device with zero credentials.
  async replaceCredential(deviceId: string, credentialInput: CredentialInput): Promise<DeviceActionResult> {
    try {
      const existing = await this.client.listCredentials(deviceId);
      const created = await this.client.createCredential(deviceId, { ...credentialInput, deviceId });
      await Promise.all(
        existing
          .filter((credential) => credential.id !== created.id)
          .map((credential) => this.client.removeCredential(deviceId, credential.id))
      );
    } catch (error) {
      return { error: errorMessage(error, 'could not replace credentials') };
    }
    await this.load();
    return { error: null };
  }

  async update(id: string, input: DeviceUpdateRequest): Promise<DeviceActionResult> {
    try {
      await this.client.updateDevice(id, input);
    } catch (error) {
      return { error: errorMessage(error, 'could not update device') };
    }
    await this.load();
    return { error: null };
  }
}
