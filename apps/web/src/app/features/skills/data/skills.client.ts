import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { type Skill, type SkillCreateRequest, skillSchema, type SkillUpdateRequest } from '@opspilot/shared';
import { firstValueFrom } from 'rxjs';

// typed http i/o against the skill crud endpoints. relative '/api' urls ride the
// same-origin session cookie (withFetch). responses parse through skillSchema so
// timestamps normalize to iso strings and any leaked column fails the strict parse.
@Injectable()
export class SkillsClient {
  private readonly http = inject(HttpClient);

  create(input: SkillCreateRequest): Promise<Skill> {
    return firstValueFrom(this.http.post<unknown>('/api/skills', input)).then((row) => skillSchema.parse(row));
  }

  list(): Promise<Skill[]> {
    return firstValueFrom(this.http.get<unknown[]>('/api/skills')).then((rows) => skillSchema.array().parse(rows));
  }

  // scoped to a device: global + that device's rows (server-side findForDevice). the
  // per-service run surface uses this so it never receives other devices' skills.
  listForDevice(deviceId: string): Promise<Skill[]> {
    return firstValueFrom(this.http.get<unknown[]>('/api/skills', { params: { deviceId } })).then((rows) =>
      skillSchema.array().parse(rows)
    );
  }

  remove(id: string): Promise<void> {
    return firstValueFrom(this.http.delete<void>(`/api/skills/${id}`));
  }

  update(id: string, input: SkillUpdateRequest): Promise<Skill> {
    return firstValueFrom(this.http.patch<unknown>(`/api/skills/${id}`, input)).then((row) => skillSchema.parse(row));
  }
}
