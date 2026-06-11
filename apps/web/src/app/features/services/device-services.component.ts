import { ChangeDetectionStrategy, Component, effect, inject, input, signal } from '@angular/core';
import { type DiagnosisSynthesis, type Service } from '@opspilot/shared';
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
  imports: [HlmBadge, HlmButton, ...HlmCardImports, ...HlmTableImports, ...HlmAlertDialogImports],
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

  // load the managed list once the device id input is bound; re-runs only if the
  // bound device ever changes (it doesn't, rows track by id).
  private readonly loadEffect = effect(() => {
    void this.store.load(this.deviceId());
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

  // runs a fresh diagnosis for one service row; the store keys the result by id.
  async diagnose(service: Service): Promise<void> {
    await this.diagnosis.diagnose(this.deviceId(), service.id);
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

  requestDelete(service: Service, dialog: { open: () => void }): void {
    this.serviceToDelete.set(service);
    dialog.open();
  }
}
