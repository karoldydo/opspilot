import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DevicesClient } from '@app/features/devices/data/devices.client';
import { SkillsClient } from '@app/features/skills/data/skills.client';
import { SkillsStore } from '@app/features/skills/data/skills.store';
import { SkillFormDialog, type SkillFormDialogContext } from '@app/features/skills/dialogs/skill-form.dialog';
import { type Device, type Skill } from '@opspilot/shared';
import { toast } from '@spartan-ng/brain/sonner';
import { HlmAlertDialogImports } from '@spartan-ng/helm/alert-dialog';
import { HlmDialogService } from '@spartan-ng/helm/dialog';

// skill catalog view (global + per-device). store/client + DevicesClient (for the scope select) provided here (not providedIn: 'root', per angular.md); the form dialog gets the store + device list via context since it renders in a cdk overlay outside this injector.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [...HlmAlertDialogImports],
  providers: [SkillsClient, SkillsStore, DevicesClient],
  selector: 'app-skills',
  templateUrl: './skills.component.html',
})
export class SkillsComponent {
  private readonly devicesClient = inject(DevicesClient);
  private readonly dialog = inject(HlmDialogService);

  protected readonly store = inject(SkillsStore);

  // devices drive the scope select in the form and the scope label in the table.
  protected readonly devices = signal<Device[]>([]);

  protected readonly skillToDelete = signal<null | Skill>(null);

  // device id → name lookup so a per-device skill renders its device name.
  private readonly deviceNames = computed(() => new Map(this.devices().map((device) => [device.id, device.name])));

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

  // global skills (deviceId null) render "Global"; a per-device skill renders its
  // device name, falling back to the raw id if the device list hasn't loaded yet.
  scopeLabel(skill: Skill): string {
    if (skill.deviceId === null) {
      return 'Global';
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
