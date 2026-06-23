import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import {
  type ScanResult,
  scanResultSchema,
  type Service,
  type ServiceCreateRequest,
  serviceSchema,
  type ServiceUpdateRequest,
} from '@opspilot/shared';
import { firstValueFrom } from 'rxjs';

// typed http i/o against the scan + services endpoints, nested under the device.
// relative '/api' urls ride the same-origin session cookie (withFetch). responses parse
// through the shared zod contract so timestamps normalize and any leaked runtime/secret
// key fails the strict parse.
@Injectable()
export class ServicesClient {
  private readonly http = inject(HttpClient);

  createService(deviceId: string, input: ServiceCreateRequest): Promise<Service> {
    return firstValueFrom(this.http.post<unknown>(`/api/devices/${deviceId}/services`, input)).then((row) =>
      serviceSchema.parse(row)
    );
  }

  // single-service fetch for the detail page's deep-link/refresh path, where no warm list
  // exists. mirrors listServices but parses one object through the same contract.
  getService(deviceId: string, serviceId: string): Promise<Service> {
    return firstValueFrom(this.http.get<unknown>(`/api/devices/${deviceId}/services/${serviceId}`)).then((row) =>
      serviceSchema.parse(row)
    );
  }

  listServices(deviceId: string): Promise<Service[]> {
    return firstValueFrom(this.http.get<unknown[]>(`/api/devices/${deviceId}/services`)).then((rows) =>
      serviceSchema.array().parse(rows)
    );
  }

  removeService(deviceId: string, serviceId: string): Promise<void> {
    return firstValueFrom(this.http.delete<void>(`/api/devices/${deviceId}/services/${serviceId}`));
  }

  // the scan body is empty — the device id in the path is the only input. the
  // result is ephemeral host state, never persisted.
  scan(deviceId: string): Promise<ScanResult> {
    return firstValueFrom(this.http.post<unknown>(`/api/devices/${deviceId}/scan`, {})).then((row) =>
      scanResultSchema.parse(row)
    );
  }

  updateService(deviceId: string, serviceId: string, input: ServiceUpdateRequest): Promise<Service> {
    return firstValueFrom(this.http.patch<unknown>(`/api/devices/${deviceId}/services/${serviceId}`, input)).then(
      (row) => serviceSchema.parse(row)
    );
  }
}
