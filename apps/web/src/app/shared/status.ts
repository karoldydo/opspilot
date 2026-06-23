import { type DiagnosisSynthesis } from '@opspilot/shared';
import { hlm } from '@spartan-ng/helm/utils';

// the client status concept: the three wire statuses plus the client-only 'unknown'
// for a service with no runs. 'unknown' is never a wire value — absence of a run is
// absence of status — so it renders neutral grey, never green.
export type ServiceStatus = 'unknown' | DiagnosisSynthesis['status'];

// canonical rank: worst first on an ascending sort (down < degraded < healthy < unknown).
// the default status sort surfaces what's broken at the top; the host rollup picks the
// lowest rank (the worst) across a host's services.
export const STATUS_RANK: Record<ServiceStatus, number> = {
  degraded: 1,
  down: 0,
  healthy: 2,
  unknown: 3,
};

// status → status-label badge fill (cream text on the on-cream status ramp). unknown is
// the neutral grey badge so a no-runs service never reads as green.
const BADGE_CLASS: Record<ServiceStatus, string> = {
  degraded: 'bg-op-warning text-op-cream',
  down: 'bg-op-danger text-op-cream',
  healthy: 'bg-op-success-text text-op-cream',
  unknown: 'bg-op-surface-card text-op-mute',
};

// status → status-dot text color (the ● glyph at the head of a row); grey for unknown.
const DOT_CLASS: Record<ServiceStatus, string> = {
  degraded: 'text-op-warning',
  down: 'text-op-danger',
  healthy: 'text-op-success-text',
  unknown: 'text-op-mute',
};

// status → status-label badge classes, merged via hlm() (twmerge over the cva surface).
export function badgeClass(status: ServiceStatus): string {
  return hlm(BADGE_CLASS[status]);
}

// status → status-dot text color, merged via hlm().
export function dotClass(status: ServiceStatus): string {
  return hlm(DOT_CLASS[status]);
}

// maps the nullable wire status (null/undefined = no runs) to the client status concept.
export function statusFromSynthesis(status: DiagnosisSynthesis['status'] | null | undefined): ServiceStatus {
  return status ?? 'unknown';
}

// host rollup: the worst status across a host's services (lowest canonical rank). an
// empty list / all-unknown rolls up to 'unknown'.
export function worstStatus(statuses: ServiceStatus[]): ServiceStatus {
  let worst: ServiceStatus = 'unknown';
  for (const status of statuses) {
    if (STATUS_RANK[status] < STATUS_RANK[worst]) {
      worst = status;
    }
  }
  return worst;
}
