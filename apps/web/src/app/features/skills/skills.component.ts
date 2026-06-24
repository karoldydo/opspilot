import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DevicesClient } from '@app/features/devices/data/devices.client';
import { SkillsClient } from '@app/features/skills/data/skills.client';
import { SkillsStore } from '@app/features/skills/data/skills.store';
import { SkillFormDialog, type SkillFormDialogContext } from '@app/features/skills/dialogs/skill-form.dialog';
import { clientTable } from '@app/shared/client-table';
import { SortHeaderComponent } from '@app/shared/components/sort-header.component';
import { TablePaginationComponent } from '@app/shared/components/table-pagination.component';
import { clickableClasses } from '@app/shared/directives/clickable-classes';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideEllipsis } from '@ng-icons/lucide';
import { type Device, type Skill } from '@opspilot/shared';
import { toast } from '@spartan-ng/brain/sonner';
import { HlmAlertDialogImports } from '@spartan-ng/helm/alert-dialog';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmDialogService } from '@spartan-ng/helm/dialog';
import { HlmDropdownMenuImports } from '@spartan-ng/helm/dropdown-menu';
import { HlmIcon } from '@spartan-ng/helm/icon';
import { HlmInput } from '@spartan-ng/helm/input';
import { HlmSelectImports } from '@spartan-ng/helm/select';
import { HlmTableImports } from '@spartan-ng/helm/table';

// a skill row carries its resolved scope label so the table can search and sort by scope
// without re-deriving the device name per cell.
interface SkillRow extends Skill {
  scope: string;
}

// skill catalog view (global + per-device) as a datatable. store/client + DevicesClient (for the
// scope select) provided here (not providedIn: 'root', per angular.md); the form dialog gets the
// store + device list via context since it renders in a cdk overlay outside this injector.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ...HlmAlertDialogImports,
    ...HlmTableImports,
    ...HlmSelectImports,
    ...HlmDropdownMenuImports,
    HlmButton,
    HlmIcon,
    HlmInput,
    NgIcon,
    SortHeaderComponent,
    TablePaginationComponent,
  ],
  providers: [SkillsClient, SkillsStore, DevicesClient, provideIcons({ lucideEllipsis })],
  selector: 'app-skills',
  templateUrl: './skills.component.html',
})
export class SkillsComponent {
  private readonly devicesClient = inject(DevicesClient);
  private readonly dialog = inject(HlmDialogService);

  protected readonly store = inject(SkillsStore);

  // op-* affordance for the alert-dialog confirm/cancel buttons; merged over hlmBtn's cva through classes()/twmerge.
  protected readonly dangerSolidAffordance = clickableClasses('danger-solid');

  // devices drive the scope select in the form and the scope label in the table.
  protected readonly devices = signal<Device[]>([]);

  protected readonly secondaryAffordance = clickableClasses('secondary');

  protected readonly skillToDelete = signal<null | Skill>(null);

  // device id → name lookup so a per-device skill renders its device name.
  private readonly deviceNames = computed(() => new Map(this.devices().map((device) => [device.id, device.name])));

  // skill rows enriched with their scope label for display, search and sort.
  private readonly rows = computed<SkillRow[]>(() =>
    this.store.skills().map((skill) => ({ ...skill, scope: this.scopeLabel(skill) }))
  );

  // the shared datatable: name-sorted by default, free-text search across name/command,
  // a global/host-scoped column filter, client pagination.
  protected readonly table = clientTable<SkillRow>({
    filters: {
      scope: (row, value) => (value === 'global' ? row.deviceId === null : row.deviceId !== null),
    },
    initialSort: { dir: 'asc', key: 'name' },
    searchText: (row) => `${row.name} ${row.commandTemplate}`,
    sorters: {
      name: (row) => row.name.toLowerCase(),
      params: (row) => row.parameters.length,
      scope: (row) => row.scope.toLowerCase(),
    },
    source: this.rows,
  });

  // the active scope filter value, mirrored back onto the toolbar select.
  protected readonly scopeFilter = computed(() => this.table.filterValues()['scope'] ?? 'all');

  constructor() {
    void this.store.load();
    void this.loadDevices();
  }

  async confirmDelete(dialog: { close: () => void }): Promise<void> {
    const skill = this.skillToDelete();
    if (skill) {
      const result = await this.store.remove(skill.id);
      toast(result.error ? '[x] could not delete skill' : '[-] skill deleted');
    }
    dialog.close();
  }

  openCreate(): void {
    this.openForm('create', null);
  }

  openEdit(skill: Skill): void {
    this.openForm('edit', skill);
  }

  requestDelete(skill: Skill, dialog: { open: () => void }): void {
    this.skillToDelete.set(skill);
    dialog.open();
  }

  // global skills (deviceId null) render "global"; a per-device skill renders its
  // device name, falling back to the raw id if the device list hasn't loaded yet.
  scopeLabel(skill: Skill): string {
    if (skill.deviceId === null) {
      return 'global';
    }
    return this.deviceNames().get(skill.deviceId) ?? skill.deviceId;
  }

  private async loadDevices(): Promise<void> {
    try {
      this.devices.set(await this.devicesClient.listDevices());
    } catch {
      // the scope select degrades to ids — a device fetch failure must not block
      // the skill catalog from rendering.
    }
  }

  private openForm(mode: 'create' | 'edit', skill: null | Skill): void {
    const context: SkillFormDialogContext = { devices: this.devices(), mode, skill, store: this.store };
    this.dialog.open(SkillFormDialog, { context });
  }
}
