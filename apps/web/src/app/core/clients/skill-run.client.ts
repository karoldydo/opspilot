import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { type SkillRunRequest, type SkillRunResult, skillRunResultSchema } from '@opspilot/shared';
import { firstValueFrom } from 'rxjs';

// single request/response client against the skill-run endpoint, nested under the
// device/service/skill path. the body carries values only for `input`-source params;
// `service`-source params are resolved server-side from the service row and are never
// sent from here (the s-06 guarantee). the result is parsed through the shared zod
// contract so a malformed/leaked shape fails at the boundary. plain HttpClient so the
// 401 session-expiry interceptor applies (auth.interceptor.ts). mirrors skills.client.
@Injectable()
export class SkillRunClient {
  private readonly http = inject(HttpClient);

  run(deviceId: string, serviceId: string, skillId: string, body: SkillRunRequest): Promise<SkillRunResult> {
    return firstValueFrom(
      this.http.post<unknown>(`/api/devices/${deviceId}/services/${serviceId}/skills/${skillId}/run`, body)
    ).then((row) => skillRunResultSchema.parse(row));
  }
}
