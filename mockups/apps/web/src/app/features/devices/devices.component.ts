import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { DevicesClient } from '@app/features/devices/data/devices.client';
import { DevicesStore } from '@app/features/devices/data/devices.store';
import { DeviceFormDialog, type DeviceFormDialogContext } from '@app/features/devices/dialogs/device-form.dialog';
import { DeviceServicesComponent } from '@app/features/services/components/device-services.component';
import { type Device } from '@opspilot/shared';
import { HlmAlertDialogImports } from '@spartan-ng/helm/alert-dialog';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmDialogService } from '@spartan-ng/helm/dialog';
import { HlmEmptyImports } from '@spartan-ng/helm/empty';
import { HlmTableImports } from '@spartan-ng/helm/table';

// the shared device inventory view: a table of every device with edit/delete row
// actions, an empty state, and an add button. all data fetching lives in the
// store; the component only opens dialogs and reads signals. the store + client
// are provided here (not providedIn: 'root', per angular.md) so the lazy feature
// owns their lifecycle; the form dialog renders in a cdk overlay outside this
// injector, so the list passes the store instance via dialog context.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DatePipe,
    HlmButton,
    ...HlmTableImports,
    ...HlmAlertDialogImports,
    ...HlmEmptyImports,
    DeviceServicesComponent,
  ],
  providers: [DevicesClient, DevicesStore],
  selector: 'app-devices',
  templateUrl: './devices.component.html',
})
export class DevicesComponent {
  private readonly dialog = inject(HlmDialogService);

  protected readonly store = inject(DevicesStore);

  // the device a pending delete confirmation refers to — drives the alert-dialog copy.
  protected readonly deviceToDelete = signal<Device | null>(null);

  constructor() {
    void this.store.load();
  }

  async confirmDelete(dialog: { close: () => void }): Promise<void> {
    const device = this.deviceToDelete();
    if (device) {
      await this.store.remove(device.id);
    }
    dialog.close();
  }

  openEdit(device: Device): void {
    this.openForm('edit', device);
  }

  openCreate(): void {
    this.openForm('create', null);
  }

  requestDelete(device: Device, dialog: { open: () => void }): void {
    this.deviceToDelete.set(device);
    dialog.open();
  }

  private openForm(mode: 'create' | 'edit', device: Device | null): void {
    const context: DeviceFormDialogContext = { device, mode, store: this.store };
    this.dialog.open(DeviceFormDialog, { context });
  }
}
