import { DatePipe, DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { DiagnosisClient } from '@app/features/diagnosis/data/diagnosis.client';
import { DiagnosisStore } from '@app/features/diagnosis/data/diagnosis.store';
import { type DiagnosisSynthesis, type RunRecord, type RunStep } from '@opspilot/shared';

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

// step kind → terminal prefix glyph + line color, mirroring the mockup palette
// (PRE/COL, mockups/index.html:802-803): cmd $/cream, sys ·/ash, ok +/success,
// warn !/warning, result =/terminal-blue. the contract carries only kind+text; the
// design layer owns the styling.
const STEP_CLASS: Record<RunStep['kind'], { colorClass: string; prefix: string }> = {
  cmd: { colorClass: 'text-op-cream', prefix: '$' },
  ok: { colorClass: 'text-op-success', prefix: '+' },
  result: { colorClass: 'text-op-terminal-blue', prefix: '=' },
  sys: { colorClass: 'text-op-ash', prefix: '·' },
  warn: { colorClass: 'text-op-warning', prefix: '!' },
};

// the standalone diagnose-hero (drill-in from a service row): re-runs the existing sse
// stream and renders the single real synthesis in the terminal presentation, with a
// click-to-replay history from the existing replay list. no apply/remediation action —
// diagnose stays GET-only (frame d5). store + client provided here (not providedIn:
// 'root', per angular.md) so the screen owns the stream lifecycle.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, DecimalPipe, RouterLink],
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

  // the opening narration burst — every step except a trailing `result` line, which is
  // the closing `= done in Xs` step. splitting it out lets the terminal read in honest
  // temporal order: opening steps → analyzing heartbeat → synthesis summary → done line.
  protected readonly leadSteps = computed(() => {
    const steps = this.entry().steps;
    return steps[steps.length - 1]?.kind === 'result' ? steps.slice(0, -1) : steps;
  });

  // the closing `= done in Xs — status: …` line, rendered after the synthesis summary so
  // it lands below the content it summarizes (null until the run completes).
  protected readonly doneStep = computed(() => {
    const steps = this.entry().steps;
    const last = steps[steps.length - 1];
    return last?.kind === 'result' ? last : null;
  });

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

  // step kind → terminal prefix glyph + line color (mockup palette).
  stepClass(kind: RunStep['kind']): { colorClass: string; prefix: string } {
    return STEP_CLASS[kind];
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
