import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { DiagnosisClient } from '@app/features/diagnosis/data/diagnosis.client';
import { DiagnosisStore } from '@app/features/diagnosis/data/diagnosis.store';
import { type DiagnosisSynthesis, type RunRecord } from '@opspilot/shared';

// status → synthesis-badge fill (cream text on the on-cream status ramp, mockup statusBadge()).
const BADGE_CLASS: Record<DiagnosisSynthesis['status'], string> = {
  degraded: 'bg-op-warning text-op-cream',
  down: 'bg-op-danger text-op-cream',
  healthy: 'bg-op-success-text text-op-cream',
};

// status → recent-run dot text color (the ● glyph in a replay chip).
const DOT_CLASS: Record<DiagnosisSynthesis['status'], string> = {
  degraded: 'text-op-warning',
  down: 'text-op-danger',
  healthy: 'text-op-success-text',
};

// the standalone diagnose-hero (drill-in from a service row): re-runs the existing sse
// stream and renders the single real synthesis in the terminal presentation, with a
// click-to-replay history from the existing replay list. no apply/remediation action —
// diagnose stays GET-only (frame d5). store + client provided here (not providedIn:
// 'root', per angular.md) so the screen owns the stream lifecycle.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, RouterLink],
  providers: [DiagnosisClient, DiagnosisStore],
  selector: 'app-diagnose-hero',
  templateUrl: './diagnose-hero.component.html',
})
export class DiagnoseHeroComponent {
  private readonly route = inject(ActivatedRoute);

  protected readonly diagnosis = inject(DiagnosisStore);

  // route + query params as signals so the screen tracks navigation without zone cd.
  private readonly paramMap = toSignal(this.route.paramMap);

  private readonly queryMap = toSignal(this.route.queryParamMap);

  protected readonly deviceId = computed(() => this.paramMap()?.get('deviceId') ?? '');

  protected readonly serviceId = computed(() => this.paramMap()?.get('serviceId') ?? '');

  // friendly target labels passed by the drill-in link; fall back to the raw ids.
  protected readonly deviceName = computed(() => this.queryMap()?.get('device') ?? '');

  protected readonly serviceName = computed(() => this.queryMap()?.get('service') ?? this.serviceId());

  // the live diagnosis slice for this service row; reads the store's entries signal so
  // the template tracks each streamed frame.
  protected readonly entry = computed(() => this.diagnosis.entry(this.serviceId()));

  // the synthesis to render — the final result while idle, the progressive partial mid-stream.
  protected readonly view = computed(() => this.entry().result ?? this.entry().partial);

  // serviceIds whose recent-runs list has already been fetched — one load per row.
  private readonly loadedRuns = new Set<string>();

  // load the replay history once the route ids resolve.
  private readonly runsEffect = effect(() => {
    const deviceId = this.deviceId();
    const serviceId = this.serviceId();
    if (deviceId && serviceId && !this.loadedRuns.has(serviceId)) {
      this.loadedRuns.add(serviceId);
      void this.diagnosis.loadRuns(deviceId, serviceId);
    }
  });

  badgeClass(status: DiagnosisSynthesis['status']): string {
    return BADGE_CLASS[status];
  }

  // status → recent-run dot text color.
  dotClass(status: DiagnosisSynthesis['status']): string {
    return DOT_CLASS[status];
  }

  // renders a saved run statically in the same hero — no re-stream (frame d5).
  replay(run: RunRecord): void {
    this.diagnosis.replay(this.serviceId(), run);
  }

  // re-opens the existing sse stream for this service; the store keys the progressive
  // partial + final result by id and tears the stream down on completion.
  rerun(): void {
    this.diagnosis.stream(this.deviceId(), this.serviceId());
  }
}
