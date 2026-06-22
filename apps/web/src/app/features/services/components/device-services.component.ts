import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, effect, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DiagnosisClient } from '@app/features/diagnosis/data/diagnosis.client';
import { DiagnosisStore } from '@app/features/diagnosis/data/diagnosis.store';
import { ServiceSkillsComponent } from '@app/features/services/components/service-skills.component';
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
import { type DiagnosisSynthesis, type RunRecord, type Service } from '@opspilot/shared';
import { toast } from '@spartan-ng/brain/sonner';
import { HlmAlertDialogImports } from '@spartan-ng/helm/alert-dialog';
import { HlmDialogService } from '@spartan-ng/helm/dialog';

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

// managed-services section for one device row (scan + curated table with rename/delete). each instance provides its own ServicesClient + ServicesStore (not providedIn: 'root', per angular.md) so rows stay isolated; the dialogs get the store via context since they render in a cdk overlay outside this injector.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, RouterLink, ...HlmAlertDialogImports, ServiceSkillsComponent, ClickableDirective],
  providers: [ServicesClient, ServicesStore, DiagnosisClient, DiagnosisStore],
  selector: 'app-device-services',
  templateUrl: './device-services.component.html',
})
export class DeviceServicesComponent {
  private readonly dialog = inject(HlmDialogService);

  readonly deviceId = input.required<string>();

  readonly deviceName = input.required<string>();

  // per-service diagnosis slices (loading/result/error), keyed by service id so
  // diagnosing one row never clobbers another's panel.
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

  // once the curated services resolve, fetch each row's recent runs so the replay list
  // is populated on first render (and after a reload). the set keeps it one fetch per row.
  private readonly runsEffect = effect(() => {
    const deviceId = this.deviceId();
    for (const service of this.store.services()) {
      if (!this.loadedRuns.has(service.id)) {
        this.loadedRuns.add(service.id);
        void this.diagnosis.loadRuns(deviceId, service.id);
      }
    }
  });

  badgeClass(status: DiagnosisSynthesis['status']): string {
    return BADGE_CLASS[status];
  }

  async confirmDelete(dialog: { close: () => void }): Promise<void> {
    const service = this.serviceToDelete();
    if (service) {
      const result = await this.store.remove(this.deviceId(), service.id);
      toast(result.error ? '[x] could not delete service' : '[-] service deleted');
    }
    dialog.close();
  }

  // status → recent-run dot text color.
  dotClass(status: DiagnosisSynthesis['status']): string {
    return DOT_CLASS[status];
  }

  // opens a fresh live diagnosis stream for one service row; the store keys the
  // progressive partial + final result by id and tears the stream down on completion.
  diagnose(service: Service): void {
    this.diagnosis.stream(this.deviceId(), service.id);
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

  // renders a saved run statically in the row's card — no re-stream (frame d5).
  replay(service: Service, run: RunRecord): void {
    this.diagnosis.replay(service.id, run);
  }

  requestDelete(service: Service, dialog: { open: () => void }): void {
    this.serviceToDelete.set(service);
    dialog.open();
  }
}
