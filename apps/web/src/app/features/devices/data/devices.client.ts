import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import {
  type Credential,
  type CredentialCreateRequest,
  credentialSchema,
  type Device,
  type DeviceCreateRequest,
  deviceSchema,
  type DeviceUpdateRequest,
} from '@opspilot/shared';
import { firstValueFrom } from 'rxjs';

// typed http i/o against the device + credential endpoints. relative '/api' urls ride
// the same-origin session cookie (withFetch). responses parse through the shared zod
// contracts so timestamps normalize and any leaked secret-bearing key fails the strict parse.
@Injectable()
export class DevicesClient {
  private readonly http = inject(HttpClient);

  createCredential(deviceId: string, input: CredentialCreateRequest): Promise<Credential> {
    return firstValueFrom(this.http.post<unknown>(`/api/devices/${deviceId}/credentials`, input)).then((row) =>
      credentialSchema.parse(row)
    );
  }

  createDevice(input: DeviceCreateRequest): Promise<Device> {
    return firstValueFrom(this.http.post<unknown>('/api/devices', input)).then((row) => deviceSchema.parse(row));
  }

  listCredentials(deviceId: string): Promise<Credential[]> {
    return firstValueFrom(this.http.get<unknown[]>(`/api/devices/${deviceId}/credentials`)).then((rows) =>
      credentialSchema.array().parse(rows)
    );
  }

  listDevices(): Promise<Device[]> {
    return firstValueFrom(this.http.get<unknown[]>('/api/devices')).then((rows) => deviceSchema.array().parse(rows));
  }

  removeCredential(deviceId: string, credentialId: string): Promise<void> {
    return firstValueFrom(this.http.delete<void>(`/api/devices/${deviceId}/credentials/${credentialId}`));
  }

  removeDevice(id: string): Promise<void> {
    return firstValueFrom(this.http.delete<void>(`/api/devices/${id}`));
  }

  updateDevice(id: string, input: DeviceUpdateRequest): Promise<Device> {
    return firstValueFrom(this.http.patch<unknown>(`/api/devices/${id}`, input)).then((row) => deviceSchema.parse(row));
  }
}
