import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { DevicesClient } from '@app/features/devices/data/devices.client';
import { DevicesStore } from '@app/features/devices/data/devices.store';
import { DeviceFormDialog, type DeviceFormDialogContext } from '@app/features/devices/dialogs/device-form.dialog';
import { DeviceServicesComponent } from '@app/features/services/components/device-services.component';
import { ClickableDirective } from '@app/shared/directives/clickable.directive';
import { type Device } from '@opspilot/shared';
import { toast } from '@spartan-ng/brain/sonner';
import { HlmAlertDialogImports } from '@spartan-ng/helm/alert-dialog';
import { HlmDialogService } from '@spartan-ng/helm/dialog';

// device inventory view. store + client provided here (not providedIn: 'root', per angular.md); the form dialog gets the store via context since it renders in a cdk overlay outside this injector.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, ...HlmAlertDialogImports, DeviceServicesComponent, ClickableDirective],
  providers: [DevicesClient, DevicesStore],
  selector: 'app-devices',
  templateUrl: './devices.component.html',
})
export class DevicesComponent {
  private readonly dialog = inject(HlmDialogService);

  protected readonly store = inject(DevicesStore);

  protected readonly deviceToDelete = signal<Device | null>(null);

  constructor() {
    void this.store.load();
  }

  async confirmDelete(dialog: { close: () => void }): Promise<void> {
    const device = this.deviceToDelete();
    if (device) {
      const result = await this.store.remove(device.id);
      toast(result.error ? '[x] could not delete device' : '[-] device deleted');
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
