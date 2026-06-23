import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { Router } from '@angular/router';
import { DiagnosisClient } from '@app/features/diagnosis/data/diagnosis.client';
import { DiagnosisStore } from '@app/features/diagnosis/data/diagnosis.store';
import { ServicesClient } from '@app/features/services/data/services.client';
import { ServicesStore } from '@app/features/services/data/services.store';
import {
  RenameServiceDialog,
  type RenameServiceDialogContext,
} from '@app/features/services/dialogs/rename-service.dialog';
import {
  ScanServicesDialog,
  type ScanServicesDialogContext,
} from '@app/features/services/dialogs/scan-services.dialog';
import { clickableClasses } from '@app/shared/directives/clickable-classes';
import { ClickableDirective } from '@app/shared/directives/clickable.directive';
import { type DiagnosisSynthesis, type Service } from '@opspilot/shared';
import { toast } from '@spartan-ng/brain/sonner';
import { HlmAlertDialogImports } from '@spartan-ng/helm/alert-dialog';
import { HlmDialogService } from '@spartan-ng/helm/dialog';

// status → status-label badge fill (cream text on the on-cream status ramp, mockup statusBadge()).
const BADGE_CLASS: Record<DiagnosisSynthesis['status'], string> = {
  degraded: 'bg-op-warning text-op-cream',
  down: 'bg-op-danger text-op-cream',
  healthy: 'bg-op-success-text text-op-cream',
};

// unknown is client-only (not in the wire enum) — a neutral grey badge for a service with no
// runs, so its status never reads as green. kept off BADGE_CLASS, which is keyed on the three
// real statuses only.
const UNKNOWN_BADGE = 'bg-op-surface-card text-op-mute';

// status → status-dot text color (the ● glyph at the head of a row).
const DOT_CLASS: Record<DiagnosisSynthesis['status'], string> = {
  degraded: 'text-op-warning',
  down: 'text-op-danger',
  healthy: 'text-op-success-text',
};

// grey dot for a service with no runs (unknown), mirroring UNKNOWN_BADGE.
const UNKNOWN_DOT = 'text-op-mute';

// a device's aggregate status — the wire statuses plus the client-only 'unknown' (no runs /
// no services), surfaced to the parent so it can colour the device-level dot.
export type DeviceStatus = 'unknown' | DiagnosisSynthesis['status'];

// rank so a device rolls up to the worst status across its services' latest runs
// (down > degraded > healthy > unknown).
const STATUS_RANK: Record<DeviceStatus, number> = { degraded: 2, down: 3, healthy: 1, unknown: 0 };

// managed-services section for one device row (scan + slim curated table). each row shows
// status · name · container · status label · edit/delete and navigates into the service detail
// page; everything operational (diagnose/skills/replay) now lives on that page. each instance
// provides its own ServicesClient + ServicesStore (not providedIn: 'root', per angular.md) so rows
// stay isolated; the DiagnosisStore here only feeds each row's status dot/label from the latest
// saved run. dialogs get the store via context since they render in a cdk overlay outside this
// injector.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [...HlmAlertDialogImports, ClickableDirective],
  providers: [ServicesClient, ServicesStore, DiagnosisClient, DiagnosisStore],
  selector: 'app-device-services',
  templateUrl: './device-services.component.html',
})
export class DeviceServicesComponent {
  private readonly dialog = inject(HlmDialogService);
  private readonly router = inject(Router);

  readonly deviceId = input.required<string>();

  readonly deviceName = input.required<string>();

  // surfaces this device's aggregate status (worst across its services) to the parent, which
  // owns the device-level dot. emitted reactively from the worstStatus computed below — the
  // DiagnosisStore is provided per-row, so the parent can't read it directly.
  readonly statusChange = output<DeviceStatus>();

  // per-service diagnosis slices — in the slim list only the latest saved run is read, to colour
  // each row's status dot/label.
  protected readonly diagnosis = inject(DiagnosisStore);

  protected readonly store = inject(ServicesStore);

  // op-* affordance for the alert-dialog confirm/cancel buttons; merged over hlmBtn's cva through classes()/twmerge.
  protected readonly dangerSolidAffordance = clickableClasses('danger-solid');

  protected readonly secondaryAffordance = clickableClasses('secondary');

  protected readonly serviceToDelete = signal<null | Service>(null);

  // serviceIds whose recent-runs list has already been fetched — guards the runs
  // effect from re-loading a row when the services signal changes for other reasons.
  private readonly loadedRuns = new Set<string>();

  // load the managed list once the device id input is bound; re-runs only if the
  // bound device ever changes (it doesn't, rows track by id).
  private readonly loadEffect = effect(() => {
    void this.store.load(this.deviceId());
  });

  // once the curated services resolve, fetch each row's recent runs so the status dot/label is
  // populated on first render (and after a reload). the set keeps it one fetch per row.
  private readonly runsEffect = effect(() => {
    const deviceId = this.deviceId();
    for (const service of this.store.services()) {
      if (!this.loadedRuns.has(service.id)) {
        this.loadedRuns.add(service.id);
        void this.diagnosis.loadRuns(deviceId, service.id);
      }
    }
  });

  // the worst status across this device's services' latest runs; empty list / no runs → unknown.
  // recomputes as each row's runs land (loadRuns patches the diagnosis store).
  protected readonly worstStatus = computed<DeviceStatus>(() => {
    let worst: DeviceStatus = 'unknown';
    for (const service of this.store.services()) {
      const status: DeviceStatus = this.diagnosis.entry(service.id).runs[0]?.synthesis?.status ?? 'unknown';
      if (STATUS_RANK[status] > STATUS_RANK[worst]) {
        worst = status;
      }
    }
    return worst;
  });

  // surface the aggregate to the parent whenever it changes — the parent keeps a
  // per-device record and renders the dot from it.
  private readonly statusEffect = effect(() => this.statusChange.emit(this.worstStatus()));

  // status → status-label badge fill; null (unknown) falls back to the neutral grey badge.
  badgeClass(status: DiagnosisSynthesis['status'] | null): string {
    return status ? BADGE_CLASS[status] : UNKNOWN_BADGE;
  }

  async confirmDelete(dialog: { close: () => void }): Promise<void> {
    const service = this.serviceToDelete();
    if (service) {
      const result = await this.store.remove(this.deviceId(), service.id);
      toast(result.error ? '[x] could not delete service' : '[-] service deleted');
    }
    dialog.close();
  }

  // status → status-dot text color; null (unknown) falls back to grey.
  dotClass(status: DiagnosisSynthesis['status'] | null): string {
    return status ? DOT_CLASS[status] : UNKNOWN_DOT;
  }

  // navigates into the service detail page (the row's primary action). the edit/delete buttons
  // stopPropagation so they never trigger this.
  goToService(service: Service): void {
    void this.router.navigate(['/devices', this.deviceId(), 'services', service.id]);
  }

  openRename(service: Service): void {
    const context: RenameServiceDialogContext = { deviceId: this.deviceId(), service, store: this.store };
    this.dialog.open(RenameServiceDialog, { context });
  }

  openScan(): void {
    const context: ScanServicesDialogContext = {
      deviceId: this.deviceId(),
      deviceName: this.deviceName(),
      store: this.store,
    };
    // size the dialog to its content (the scan table) instead of the default fixed
    // sm:max-w-lg: w-fit grows to the table's natural width, capped at the viewport,
    // and overflow-x-auto scrolls the table inside the dialog when it exceeds that cap.
    this.dialog.open(ScanServicesDialog, {
      contentClass: 'w-fit max-w-[calc(100vw-2rem)] overflow-x-auto sm:max-w-[calc(100vw-2rem)]',
      context,
    });
  }

  requestDelete(service: Service, dialog: { open: () => void }): void {
    this.serviceToDelete.set(service);
    dialog.open();
  }
}
