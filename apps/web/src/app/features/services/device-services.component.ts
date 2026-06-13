import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, effect, inject, input, signal } from '@angular/core';
import { type DiagnosisSynthesis, type RunRecord, type Service } from '@opspilot/shared';
import { HlmAlertDialogImports } from '@spartan-ng/helm/alert-dialog';
import { HlmBadge } from '@spartan-ng/helm/badge';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmCardImports } from '@spartan-ng/helm/card';
import { HlmDialogService } from '@spartan-ng/helm/dialog';
import { HlmTableImports } from '@spartan-ng/helm/table';

import { DiagnosisClient } from '../../core/clients/diagnosis.client';
import { ServicesClient } from '../../core/clients/services.client';
import { DiagnosisStore } from '../../core/stores/diagnosis.store';
import { ServicesStore } from '../../core/stores/services.store';
import { RenameServiceDialog, type RenameServiceDialogContext } from './rename-service.dialog';
import { ScanServicesDialog, type ScanServicesDialogContext } from './scan-services.dialog';
import { ServiceSkillsComponent } from './service-skills.component';

// status → badge classes. spartan's hlmBadge has no success/warning variant, so we
// keep its shape and color via tokens/utilities: down uses the semantic destructive
// token; healthy/degraded use the green/amber palette (no semantic token exists).
const BADGE_CLASS: Record<DiagnosisSynthesis['status'], string> = {
  degraded: 'border-transparent bg-amber-500/15 text-amber-700 dark:text-amber-500',
  down: 'border-transparent bg-destructive/15 text-destructive',
  healthy: 'border-transparent bg-green-600/15 text-green-700 dark:text-green-400',
};

// the managed-services section for one device row: a Scan action that opens the
// curation dialog plus a table of curated services with rename/delete. each
// instance provides its own ServicesClient + ServicesStore (not providedIn: 'root',
// per angular.md) so every device row owns isolated state; the dialogs render in a
// cdk overlay outside this injector, so the store instance is passed via context.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DatePipe,
    HlmBadge,
    HlmButton,
    ...HlmCardImports,
    ...HlmTableImports,
    ...HlmAlertDialogImports,
    ServiceSkillsComponent,
  ],
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

  // the service a pending delete confirmation refers to — drives the alert copy.
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

  // badge classes for a synthesis status — drives the result panel's status chip.
  badgeClass(status: DiagnosisSynthesis['status']): string {
    return BADGE_CLASS[status];
  }

  async confirmDelete(dialog: { close: () => void }): Promise<void> {
    const service = this.serviceToDelete();
    if (service) {
      await this.store.remove(this.deviceId(), service.id);
    }
    dialog.close();
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
    this.dialog.open(ScanServicesDialog, { context });
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
