import { HttpErrorResponse } from '@angular/common/http';
import { computed, inject, Injectable } from '@angular/core';
import { AuditClient } from '@app/features/audit/data/audit.client';
import { DevicesClient } from '@app/features/devices/data/devices.client';
import { DiagnosisClient } from '@app/features/diagnosis/data/diagnosis.client';
import { OverviewClient } from '@app/features/overview/data/overview.client';
import { ServicesClient } from '@app/features/services/data/services.client';
import { patchState, signalState } from '@ngrx/signals';
import {
  apiErrorSchema,
  type AuditEvent,
  type Device,
  type DiagnosisSynthesis,
  type OverviewMetrics,
  type Service,
} from '@opspilot/shared';

// the single needs-attention banner subject — the first service whose latest diagnosis is down/degraded.
export interface AttentionRow {
  deviceName: string;
  serviceName: string;
  status: 'degraded' | 'down';
  summary: string;
}

// one fleet row — a device with its rolled-up service health (worst across its services).
export interface FleetRow {
  deviceId: string;
  host: string;
  name: string;
  serviceCount: number;
  status: ServiceHealth;
  upCount: number;
}

// one recent-activity row, pre-derived so the template stays property-access only.
export interface RecentRow {
  action: string;
  createdAt: string;
  id: string;
  result: null | string;
  resultKind: 'danger' | 'muted' | 'success' | 'warning';
  targetId: null | string;
  targetType: null | string;
}

interface OverviewState {
  attention: AttentionRow | null;
  deviceCount: number;
  error: null | string;
  fleet: FleetRow[];
  loading: boolean;
  metrics: null | OverviewMetrics;
  recent: RecentRow[];
  serviceCount: number;
}

// the latest-diagnosis health of a service; 'unknown' means no run has ever been recorded.
type ServiceHealth = 'unknown' | DiagnosisSynthesis['status'];

// rank health so a device rolls up to the worst status among its services.
const HEALTH_RANK: Record<ServiceHealth, number> = { degraded: 2, down: 3, healthy: 1, unknown: 0 };

// how many recent activity rows the overview shows.
const RECENT_LIMIT = 6;

// pulls the user-facing message out of an http failure — the global exception filter
// shapes every error body as apiErrorSchema; falls back to a generic transport line.
function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof HttpErrorResponse) {
    const parsed = apiErrorSchema.safeParse(error.error);
    if (parsed.success) {
      return parsed.data.message;
    }
  }
  return fallback;
}

// map an audit event to its display result + colour bucket: skill runs carry an
// outcome in metadata, diagnose runs carry a synthesis status, everything else has none.
function recentResult(event: AuditEvent): Pick<RecentRow, 'result' | 'resultKind'> {
  if (event.action === 'skill.run') {
    const outcome = typeof event.metadata?.['outcome'] === 'string' ? (event.metadata['outcome'] as string) : null;
    return { result: outcome, resultKind: outcome === 'succeeded' ? 'success' : outcome ? 'danger' : 'muted' };
  }
  if (event.synthesis) {
    const status = event.synthesis.status;
    return {
      result: status,
      resultKind: status === 'healthy' ? 'success' : status === 'degraded' ? 'warning' : 'danger',
    };
  }
  return { result: null, resultKind: 'muted' };
}

// signal-based overview state, provided at the overview route (not providedIn: 'root',
// per angular.md). aggregates the new metrics endpoint with existing device/service/run/
// audit stores into the dashboard view. zoneless — async client callbacks don't trigger
// cd, so state rides a signalState container mutated through patchState.
@Injectable()
export class OverviewStore {
  private readonly auditClient = inject(AuditClient);
  private readonly devicesClient = inject(DevicesClient);
  private readonly diagnosisClient = inject(DiagnosisClient);
  private readonly overviewClient = inject(OverviewClient);
  private readonly servicesClient = inject(ServicesClient);

  private readonly state = signalState<OverviewState>({
    attention: null,
    deviceCount: 0,
    error: null,
    fleet: [],
    loading: false,
    metrics: null,
    recent: [],
    serviceCount: 0,
  });

  readonly attention = this.state.attention;

  readonly deviceCount = this.state.deviceCount;

  readonly error = this.state.error;

  readonly fleet = this.state.fleet;

  readonly isEmpty = computed(() => !this.state.loading() && this.state.deviceCount() === 0);

  readonly loading = this.state.loading;

  readonly metrics = this.state.metrics;

  readonly recent = this.state.recent;

  readonly serviceCount = this.state.serviceCount;

  // hydrate the dashboard: the metrics endpoint, the device list, and the audit timeline
  // in parallel, then per-device services and per-service latest-run health (best-effort —
  // a failed sub-fetch degrades that row to 'unknown', never sinks the whole screen).
  async load(): Promise<void> {
    patchState(this.state, { error: null, loading: true });
    try {
      const [metrics, devices, events] = await Promise.all([
        this.overviewClient.metrics(),
        this.devicesClient.listDevices(),
        this.auditClient.list({ limit: RECENT_LIMIT, offset: 0 }),
      ]);
      const fleet = await this.buildFleet(devices);
      patchState(this.state, {
        attention: this.pickAttention(fleet),
        deviceCount: devices.length,
        fleet: fleet.map((entry) => entry.row),
        loading: false,
        metrics,
        recent: events.map((event) => this.toRecentRow(event)),
        serviceCount: fleet.reduce((sum, entry) => sum + entry.row.serviceCount, 0),
      });
    } catch (error) {
      patchState(this.state, { error: errorMessage(error, 'could not load overview'), loading: false });
    }
  }

  // for each device, load its services and the latest-diagnosis health of each, rolling
  // the worst status up to the device. carries the degraded/down services so the caller
  // can surface the needs-attention banner without a second pass.
  private async buildFleet(devices: Device[]): Promise<{ attention: AttentionRow[]; row: FleetRow }[]> {
    return Promise.all(
      devices.map(async (device) => {
        const services = await this.servicesClient.listServices(device.id).catch(() => [] as Service[]);
        const healths = await Promise.all(services.map((service) => this.serviceHealth(device, service)));
        const status = healths.reduce<ServiceHealth>(
          (worst, entry) => (HEALTH_RANK[entry.status] > HEALTH_RANK[worst] ? entry.status : worst),
          'unknown'
        );
        const attention = healths
          .map((entry) => entry.attention)
          .filter((candidate): candidate is AttentionRow => candidate !== null);
        return {
          attention,
          row: {
            deviceId: device.id,
            host: device.host,
            name: device.name,
            serviceCount: services.length,
            status,
            upCount: healths.filter((entry) => entry.status !== 'down').length,
          },
        };
      })
    );
  }

  // the worst-ranked degraded/down service across the fleet drives the single banner.
  private pickAttention(fleet: { attention: AttentionRow[] }[]): AttentionRow | null {
    const all = fleet.flatMap((entry) => entry.attention);
    const down = all.find((entry) => entry.status === 'down');
    return down ?? all.find((entry) => entry.status === 'degraded') ?? null;
  }

  // latest-run health for one service (best-effort); a degraded/down run also yields an
  // attention candidate carrying its summary for the banner.
  private async serviceHealth(
    device: Device,
    service: Service
  ): Promise<{ attention: AttentionRow | null; status: ServiceHealth }> {
    const runs = await this.diagnosisClient.recentRuns(device.id, service.id).catch(() => []);
    const latest = runs[0];
    if (!latest) {
      return { attention: null, status: 'unknown' };
    }
    const status = latest.synthesis.status;
    const attention =
      status === 'down' || status === 'degraded'
        ? { deviceName: device.name, serviceName: service.name, status, summary: latest.synthesis.summary }
        : null;
    return { attention, status };
  }

  private toRecentRow(event: AuditEvent): RecentRow {
    return {
      action: event.action,
      createdAt: event.createdAt,
      id: event.id,
      targetId: event.targetId,
      targetType: event.targetType,
      ...recentResult(event),
    };
  }
}
