import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { DevicesClient } from '@app/features/devices/data/devices.client';
import { DevicesStore } from '@app/features/devices/data/devices.store';
import { FleetServicesClient } from '@app/features/devices/data/fleet-services.client';
import { DeviceFormDialog, type DeviceFormDialogContext } from '@app/features/devices/dialogs/device-form.dialog';
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
import { clientTable } from '@app/shared/client-table';
import { SortHeaderComponent } from '@app/shared/components/sort-header.component';
import { TablePaginationComponent } from '@app/shared/components/table-pagination.component';
import { clickableClasses } from '@app/shared/directives/clickable-classes';
import { ClickableDirective } from '@app/shared/directives/clickable.directive';
import { dotClass, STATUS_RANK, statusFromSynthesis, worstStatus } from '@app/shared/status';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideEllipsis } from '@ng-icons/lucide';
import { type Device, type ServiceWithStatus } from '@opspilot/shared';
import { toast } from '@spartan-ng/brain/sonner';
import { HlmAlertDialogImports } from '@spartan-ng/helm/alert-dialog';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmButtonGroupImports } from '@spartan-ng/helm/button-group';
import { HlmDialogService } from '@spartan-ng/helm/dialog';
import { HlmDropdownMenuImports } from '@spartan-ng/helm/dropdown-menu';
import { HlmIcon } from '@spartan-ng/helm/icon';
import { HlmInput } from '@spartan-ng/helm/input';
import { HlmSelectImports } from '@spartan-ng/helm/select';
import { HlmTableImports } from '@spartan-ng/helm/table';
import { hlm } from '@spartan-ng/helm/utils';

// a fleet row = the aggregate service plus its device's display name + host, joined
// client-side so the table can show, search and sort by host without a per-row lookup.
interface FleetRow extends ServiceWithStatus {
  deviceHost: string;
  deviceName: string;
}

// the fleet "all services" view: one table of every service across every device, fed by the
// aggregate GET /api/services read. DevicesStore still backs the host strip + device crud. the
// form/scan/rename dialogs get their store via context since they render in a cdk overlay outside
// this injector (per device-form.dialog). status comes from the endpoint, so the old parent/child
// statusChange dance is gone.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ...HlmAlertDialogImports,
    ...HlmTableImports,
    ...HlmSelectImports,
    ...HlmButtonGroupImports,
    ...HlmDropdownMenuImports,
    ClickableDirective,
    HlmButton,
    HlmIcon,
    HlmInput,
    NgIcon,
    SortHeaderComponent,
    TablePaginationComponent,
  ],
  providers: [
    DevicesClient,
    DevicesStore,
    FleetServicesClient,
    ServicesClient,
    ServicesStore,
    provideIcons({ lucideEllipsis }),
  ],
  selector: 'app-devices',
  templateUrl: './devices.component.html',
})
export class DevicesComponent {
  private readonly destroyRef = inject(DestroyRef);
  private readonly dialog = inject(HlmDialogService);
  private readonly fleet = inject(FleetServicesClient);
  private readonly router = inject(Router);
  private readonly services = inject(ServicesStore);

  protected readonly store = inject(DevicesStore);

  // op-* affordance for the alert-dialog confirm/cancel buttons; merged over hlmBtn's cva.
  protected readonly dangerSolidAffordance = clickableClasses('danger-solid');

  protected readonly secondaryAffordance = clickableClasses('secondary');

  // status → dot color, from the shared status util (single source of truth).
  protected readonly dotClass = dotClass;

  protected readonly statusFromSynthesis = statusFromSynthesis;

  protected readonly deviceToDelete = signal<Device | null>(null);

  protected readonly serviceToDelete = signal<FleetRow | null>(null);

  // a fleet-load failure surfaced above the table; the device list has its own store.error.
  protected readonly fleetError = signal<null | string>(null);

  // every service across the fleet, each carrying its latest-run status (null = no runs).
  private readonly fleetServices = signal<ServiceWithStatus[]>([]);

  // device id → device, for joining each service to its host name/address.
  private readonly deviceMap = computed(() => new Map(this.store.devices().map((device) => [device.id, device])));

  // fleet rows enriched with device name + host for display, search and sort.
  private readonly rows = computed<FleetRow[]>(() =>
    this.fleetServices().map((service) => {
      const device = this.deviceMap().get(service.deviceId);
      return { ...service, deviceHost: device?.host ?? '', deviceName: device?.name ?? service.deviceId };
    })
  );

  // the shared datatable: status-first sort (worst on top), free-text search across
  // service/container/host, host + status column filters, client pagination.
  protected readonly table = clientTable<FleetRow>({
    filters: {
      host: (row, value) => row.deviceId === value,
      status: (row, value) => statusFromSynthesis(row.status) === value,
    },
    initialSort: { dir: 'asc', key: 'status' },
    searchText: (row) => `${row.name} ${row.containerName} ${row.deviceName} ${row.deviceHost}`,
    sorters: {
      container: (row) => row.containerName.toLowerCase(),
      device: (row) => row.deviceName.toLowerCase(),
      service: (row) => row.name.toLowerCase(),
      status: (row) => STATUS_RANK[statusFromSynthesis(row.status)],
    },
    source: this.rows,
  });

  // the host id the strip currently filters to; 'all' (the default) means the whole fleet.
  protected readonly activeHostId = computed(() => this.table.filterValues()['host'] ?? 'all');

  // the active status filter value, mirrored back onto the toolbar select.
  protected readonly statusFilter = computed(() => this.table.filterValues()['status'] ?? 'all');

  // the device the action bar manages, or null when "all hosts" is selected.
  protected readonly selectedDevice = computed<Device | null>(() => {
    const id = this.activeHostId();
    return id === 'all' ? null : (this.deviceMap().get(id) ?? null);
  });

  // host strip chips: one per device with its service count + worst-status dot.
  protected readonly hostChips = computed(() =>
    this.store.devices().map((device) => {
      const statuses = this.fleetServices()
        .filter((service) => service.deviceId === device.id)
        .map((service) => statusFromSynthesis(service.status));
      return { count: statuses.length, device, status: worstStatus(statuses) };
    })
  );

  // total fleet size, shown on the "all hosts" chip.
  protected readonly fleetCount = computed(() => this.fleetServices().length);

  constructor() {
    void this.store.load();
    void this.loadFleet();
  }

  async confirmDeleteDevice(dialog: { close: () => void }): Promise<void> {
    const device = this.deviceToDelete();
    if (device) {
      const result = await this.store.remove(device.id);
      if (result.error) {
        toast('[x] could not delete device');
      } else {
        toast('[-] device deleted');
        // the host is gone — clear its filter and drop its services from the fleet.
        this.table.setFilter('host', 'all');
        await this.loadFleet();
      }
    }
    dialog.close();
  }

  async confirmDeleteService(dialog: { close: () => void }): Promise<void> {
    const service = this.serviceToDelete();
    if (service) {
      const result = await this.services.remove(service.deviceId, service.id);
      toast(result.error ? '[x] could not delete service' : '[-] service deleted');
      if (!result.error) {
        await this.loadFleet();
      }
    }
    dialog.close();
  }

  // host-strip chip classes: a black (selected) chip deepens on hover so the cream text gains
  // contrast; an unselected cream chip lifts to the card surface. hand-rolled (not appClickable)
  // because the chip toggles between the dark and light ranges, which one variant can't serve.
  chipClass(id: string): string {
    const active = this.activeHostId() === id;
    return hlm(
      'flex cursor-pointer items-center gap-2 rounded-[5px] border px-3 py-1.5 text-[12.5px] font-semibold transition-colors focus-visible:ring-1 focus-visible:ring-op-ink focus-visible:outline-none',
      active
        ? 'bg-op-ink text-op-cream border-op-ink hover:bg-op-ink-deep'
        : 'bg-op-cream text-op-ink border-op-hairline hover:bg-op-surface-card'
    );
  }

  // compose provenance for a service: a labelled project, a bare compose stack, or standalone.
  composeLabel(row: FleetRow): string {
    if (row.composeProject) {
      return `compose · ${row.composeProject}`;
    }
    return row.composePath ? 'compose' : 'standalone';
  }

  openCreate(): void {
    this.openDeviceForm('create', null);
  }

  openEdit(device: Device): void {
    this.openDeviceForm('edit', device);
  }

  // opens the rename dialog for a row; reloads the fleet on success so the new name shows
  // (the table reads from the fleet signal, not the per-device ServicesStore list).
  openRename(row: FleetRow): void {
    const context: RenameServiceDialogContext = { deviceId: row.deviceId, service: row, store: this.services };
    const ref = this.dialog.open(RenameServiceDialog, { context });
    ref.closed$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((renamed) => {
      if (renamed) {
        void this.loadFleet();
      }
    });
  }

  // opens the host scan dialog for the selected host; reloads the fleet on success so the
  // newly managed services appear.
  openScan(device: Device): void {
    const context: ScanServicesDialogContext = { deviceId: device.id, deviceName: device.name, store: this.services };
    // size the dialog to its content (the scan table) rather than the default fixed width.
    const ref = this.dialog.open(ScanServicesDialog, {
      contentClass: 'w-fit max-w-[calc(100vw-2rem)] overflow-x-auto sm:max-w-[calc(100vw-2rem)]',
      context,
    });
    ref.closed$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((added) => {
      if (added) {
        void this.loadFleet();
      }
    });
  }

  requestDeleteDevice(device: Device, dialog: { open: () => void }): void {
    this.deviceToDelete.set(device);
    dialog.open();
  }

  requestDeleteService(row: FleetRow, dialog: { open: () => void }): void {
    this.serviceToDelete.set(row);
    dialog.open();
  }

  // sets the host filter from a strip chip; 'all' clears it back to the whole fleet.
  selectHost(deviceId: string): void {
    this.table.setFilter('host', deviceId);
  }

  // navigates into the service-detail page (the row's primary action); the edit/delete
  // buttons stopPropagation so they never trigger this.
  toService(row: FleetRow): void {
    void this.router.navigate(['/devices', row.deviceId, 'services', row.id]);
  }

  private async loadFleet(): Promise<void> {
    this.fleetError.set(null);
    try {
      this.fleetServices.set(await this.fleet.listAll());
    } catch {
      this.fleetError.set('could not load services');
    }
  }

  private openDeviceForm(mode: 'create' | 'edit', device: Device | null): void {
    const context: DeviceFormDialogContext = { device, mode, store: this.store };
    this.dialog.open(DeviceFormDialog, { context });
  }
}
