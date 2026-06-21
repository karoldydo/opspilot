import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { type OverviewMetrics, overviewMetricsSchema } from '@opspilot/shared';
import { firstValueFrom } from 'rxjs';

// typed http i/o against the overview-metrics endpoint. relative '/api' urls ride the
// same-origin session cookie (withFetch). the response parses through overviewMetricsSchema
// so a malformed/leaked shape fails at the boundary.
@Injectable()
export class OverviewClient {
  private readonly http = inject(HttpClient);

  // the two tile metrics (skill-runs-24h + avg-diagnose), scoped server-side to the user.
  metrics(): Promise<OverviewMetrics> {
    return firstValueFrom(this.http.get<unknown>('/api/overview/metrics')).then((row) =>
      overviewMetricsSchema.parse(row)
    );
  }
}
