import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuditClient } from '@app/features/audit/data/audit.client';
import { DevicesClient } from '@app/features/devices/data/devices.client';
import { DiagnosisClient } from '@app/features/diagnosis/data/diagnosis.client';
import { OverviewClient } from '@app/features/overview/data/overview.client';
import { type FleetRow, OverviewStore, type RecentRow } from '@app/features/overview/data/overview.store';
import { ServicesClient } from '@app/features/services/data/services.client';
import { ClickableDirective } from '@app/shared/directives/clickable.directive';

// fleet health-dot colour by rolled-up service status.
const DOT_CLASS: Record<FleetRow['status'], string> = {
  degraded: 'bg-op-warning',
  down: 'bg-op-danger',
  healthy: 'bg-op-success',
  unknown: 'bg-op-ash',
};

// recent-activity result colour by derived bucket (mirrors the audit status ramp).
const RESULT_CLASS: Record<RecentRow['resultKind'], string> = {
  danger: 'text-op-danger-text',
  muted: 'text-op-mute',
  success: 'text-op-success-text',
  warning: 'text-op-warning-text',
};

// the overview dashboard (the `''` route): two backed tiles (skill-runs-24h, avg-diagnose)
// from /api/overview/metrics plus device/service counts, the fleet roll-up, recent activity,
// and the needs-attention banner — all from existing stores. store + clients provided here
// (not providedIn: 'root', per angular.md).
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, RouterLink, ClickableDirective],
  providers: [OverviewStore, OverviewClient, AuditClient, DevicesClient, DiagnosisClient, ServicesClient],
  selector: 'app-overview',
  templateUrl: './overview.component.html',
})
export class OverviewComponent {
  protected readonly store = inject(OverviewStore);

  // total services counted as up (latest diagnosis not 'down') across the fleet.
  protected readonly servicesUp = computed(() => this.store.fleet().reduce((sum, row) => sum + row.upCount, 0));

  // formatted avg-diagnose tile value: seconds to one decimal, or an em dash when no run
  // in the window recorded a duration.
  protected readonly avgDiagnose = computed(() => {
    const ms = this.store.metrics()?.avgDiagnoseMs;
    return ms == null ? '—' : `${(ms / 1000).toFixed(1)}s`;
  });

  // skill-runs success rate as a whole-number percent (0 when no runs in the window).
  protected readonly successPercent = computed(() =>
    Math.round((this.store.metrics()?.skillRuns24h.successRate ?? 0) * 100)
  );

  constructor() {
    void this.store.load();
  }

  // health-dot background class for a fleet row.
  dotClass(status: FleetRow['status']): string {
    return DOT_CLASS[status];
  }

  // result-text colour class for a recent-activity row.
  resultClass(kind: RecentRow['resultKind']): string {
    return RESULT_CLASS[kind];
  }
}
