import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { DevicesClient } from '@app/features/devices/data/devices.client';
import { DevicesStore } from '@app/features/devices/data/devices.store';
import { DeviceFormDialog, type DeviceFormDialogContext } from '@app/features/devices/dialogs/device-form.dialog';
import {
  DeviceServicesComponent,
  type DeviceStatus,
} from '@app/features/services/components/device-services.component';
import { clickableClasses } from '@app/shared/directives/clickable-classes';
import { ClickableDirective } from '@app/shared/directives/clickable.directive';
import { type Device } from '@opspilot/shared';
import { toast } from '@spartan-ng/brain/sonner';
import { HlmAlertDialogImports } from '@spartan-ng/helm/alert-dialog';
import { HlmDialogService } from '@spartan-ng/helm/dialog';

// status → status-dot text color for the device-level dot; unknown (no services / no runs)
// falls back to grey. mirrors the per-service DOT_CLASS/UNKNOWN_DOT maps in device-services.
const DEVICE_DOT_CLASS: Record<DeviceStatus, string> = {
  degraded: 'text-op-warning',
  down: 'text-op-danger',
  healthy: 'text-op-success-text',
  unknown: 'text-op-mute',
};

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

  // op-* affordance for the alert-dialog confirm/cancel buttons; merged over hlmBtn's cva through classes()/twmerge.
  protected readonly dangerSolidAffordance = clickableClasses('danger-solid');

  protected readonly secondaryAffordance = clickableClasses('secondary');

  protected readonly deviceToDelete = signal<Device | null>(null);

  // per-device aggregate status, keyed by device id, fed by each child's (statusChange) emit.
  // the DiagnosisStore is scoped to each device-services row, so the worst-of-services status
  // can only reach the parent through this surfaced output.
  private readonly deviceStatuses = signal<Record<string, DeviceStatus>>({});

  constructor() {
    void this.store.load();
  }

  // status → device-dot color; an unseen/absent device id renders grey (unknown).
  deviceDotClass(deviceId: string): string {
    return DEVICE_DOT_CLASS[this.deviceStatuses()[deviceId] ?? 'unknown'];
  }

  // records a child's surfaced aggregate so the device-name dot can read it.
  setDeviceStatus(deviceId: string, status: DeviceStatus): void {
    this.deviceStatuses.update((statuses) => ({ ...statuses, [deviceId]: status }));
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
