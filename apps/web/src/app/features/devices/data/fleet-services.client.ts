import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { type ServiceWithStatus, serviceWithStatusSchema } from '@opspilot/shared';
import { firstValueFrom } from 'rxjs';

// typed http i/o against the top-level fleet read. relative '/api' urls ride the same-origin
// session cookie (withFetch). the response parses through the shared zod contract so timestamps
// normalize and the nullable latest-run status is validated; no-runs rows arrive as status null.
@Injectable()
export class FleetServicesClient {
  private readonly http = inject(HttpClient);

  listAll(): Promise<ServiceWithStatus[]> {
    return firstValueFrom(this.http.get<unknown[]>('/api/services')).then((rows) =>
      serviceWithStatusSchema.array().parse(rows)
    );
  }
}
