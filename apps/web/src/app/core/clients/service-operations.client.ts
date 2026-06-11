import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { type ServiceOperation, type ServiceOperationResult, serviceOperationResultSchema } from '@opspilot/shared';
import { firstValueFrom } from 'rxjs';

// single request/response client against the operations endpoint, nested under the
// device/service path. the result is parsed through the shared zod contract so a
// malformed/leaked shape fails at the boundary. plain HttpClient so the 401
// session-expiry interceptor applies (auth.interceptor.ts). mirrors services.client.ts.
@Injectable()
export class ServiceOperationsClient {
  private readonly http = inject(HttpClient);

  run(deviceId: string, serviceId: string, operation: ServiceOperation): Promise<ServiceOperationResult> {
    return firstValueFrom(
      this.http.post<unknown>(`/api/devices/${deviceId}/services/${serviceId}/operations`, { operation })
    ).then((row) => serviceOperationResultSchema.parse(row));
  }
}
