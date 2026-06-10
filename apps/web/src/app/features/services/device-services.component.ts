import { ChangeDetectionStrategy, Component, effect, inject, input, signal } from '@angular/core';
import { type Service } from '@opspilot/shared';
import { HlmAlertDialogImports } from '@spartan-ng/helm/alert-dialog';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmDialogService } from '@spartan-ng/helm/dialog';
import { HlmTableImports } from '@spartan-ng/helm/table';

import { ServicesClient } from '../../core/clients/services.client';
import { ServicesStore } from '../../core/stores/services.store';
import { RenameServiceDialog, type RenameServiceDialogContext } from './rename-service.dialog';
import { ScanServicesDialog, type ScanServicesDialogContext } from './scan-services.dialog';

// the managed-services section for one device row: a Scan action that opens the
// curation dialog plus a table of curated services with rename/delete. each
// instance provides its own ServicesClient + ServicesStore (not providedIn: 'root',
// per angular.md) so every device row owns isolated state; the dialogs render in a
// cdk overlay outside this injector, so the store instance is passed via context.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HlmButton, ...HlmTableImports, ...HlmAlertDialogImports],
  providers: [ServicesClient, ServicesStore],
  selector: 'app-device-services',
  templateUrl: './device-services.component.html',
})
export class DeviceServicesComponent {
  private readonly dialog = inject(HlmDialogService);

  readonly deviceId = input.required<string>();

  readonly deviceName = input.required<string>();

  protected readonly store = inject(ServicesStore);

  // the service a pending delete confirmation refers to — drives the alert copy.
  protected readonly serviceToDelete = signal<null | Service>(null);

  // load the managed list once the device id input is bound; re-runs only if the
  // bound device ever changes (it doesn't, rows track by id).
  private readonly loadEffect = effect(() => {
    void this.store.load(this.deviceId());
  });

  async confirmDelete(dialog: { close: () => void }): Promise<void> {
    const service = this.serviceToDelete();
    if (service) {
      await this.store.remove(this.deviceId(), service.id);
    }
    dialog.close();
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
