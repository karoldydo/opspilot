import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { type DiagnosisSynthesis, diagnosisSynthesisSchema } from '@opspilot/shared';
import { firstValueFrom } from 'rxjs';

// typed http i/o against the diagnose endpoint, nested under the device/service
// path. the body is empty — the device + service ids in the path are the only
// input. the response is the ephemeral 4-field synthesis, never persisted, parsed
// through diagnosisSynthesisSchema so a malformed/leaked shape fails the strict
// parse at the boundary. mirrors services.client.ts scan().
@Injectable()
export class DiagnosisClient {
  private readonly http = inject(HttpClient);

  diagnose(deviceId: string, serviceId: string): Promise<DiagnosisSynthesis> {
    return firstValueFrom(this.http.post<unknown>(`/api/devices/${deviceId}/services/${serviceId}/diagnose`, {})).then(
      (row) => diagnosisSynthesisSchema.parse(row)
    );
  }
}
