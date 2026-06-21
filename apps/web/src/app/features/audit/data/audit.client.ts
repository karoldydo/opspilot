import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { type AuditEvent, auditEventSchema, type AuditListQuery } from '@opspilot/shared';
import { firstValueFrom } from 'rxjs';

// typed http i/o against the audit timeline endpoint. relative '/api' urls ride the
// same-origin session cookie (withFetch). responses parse through auditEventSchema so
// timestamps normalize to iso strings and any leaked column fails the strict parse.
@Injectable()
export class AuditClient {
  private readonly http = inject(HttpClient);

  // the merged chronological timeline, newest-first. optional query narrows by
  // action / time window and drives pagination — only defined keys are sent so an
  // omitted filter never reaches the server as an empty string.
  list(query?: AuditListQuery): Promise<AuditEvent[]> {
    const params: Record<string, string> = {};
    if (query?.action) {
      params['action'] = query.action;
    }
    if (query?.from) {
      params['from'] = query.from;
    }
    if (query?.to) {
      params['to'] = query.to;
    }
    if (query?.limit !== undefined) {
      params['limit'] = String(query.limit);
    }
    if (query?.offset !== undefined) {
      params['offset'] = String(query.offset);
    }
    return firstValueFrom(this.http.get<unknown[]>('/api/audit', { params })).then((rows) =>
      auditEventSchema.array().parse(rows)
    );
  }
}
