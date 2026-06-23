import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { type ServicesStore } from '@app/features/services/data/services.store';
import { clickableClasses } from '@app/shared/directives/clickable-classes';
import { type ScannedContainer } from '@opspilot/shared';
import { BrnDialogRef, injectBrnDialogContext } from '@spartan-ng/brain/dialog';
import { toast } from '@spartan-ng/brain/sonner';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmCheckbox } from '@spartan-ng/helm/checkbox';
import { HlmDialogDescription, HlmDialogFooter, HlmDialogHeader, HlmDialogTitle } from '@spartan-ng/helm/dialog';
import { HlmTableImports } from '@spartan-ng/helm/table';

// context the devices fleet view passes into the dialog. the store instance
// rides the context (not DI) because the dialog renders in a cdk overlay outside
// the component injector that provides ServicesStore (per device-form.dialog.ts).
export interface ScanServicesDialogContext {
  deviceId: string;
  deviceName: string;
  store: ServicesStore;
}

// the curation ui: on open it triggers a host scan, lists every detected container
// (name, image, status) with a checkbox, and on confirm persists exactly the
// checked subset as managed services — surfacing any partial-add failure without
// closing. selection is keyed by containerName (unique per host).
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    HlmButton,
    HlmCheckbox,
    HlmDialogHeader,
    HlmDialogFooter,
    HlmDialogTitle,
    HlmDialogDescription,
    ...HlmTableImports,
  ],
  selector: 'app-scan-services-dialog',
  templateUrl: './scan-services.dialog.html',
})
export class ScanServicesDialog {
  private readonly context = injectBrnDialogContext<ScanServicesDialogContext>();
  private readonly dialogRef = inject(BrnDialogRef);

  protected readonly deviceName = this.context.deviceName;

  protected readonly errorMessage = signal<null | string>(null);

  // op-* affordance for the footer buttons; merged over hlmBtn's cva through classes()/twmerge so op-* hover wins.
  protected readonly solidAffordance = clickableClasses('solid');

  protected readonly secondaryAffordance = clickableClasses('secondary');

  protected readonly store = this.context.store;

  protected readonly submitting = signal(false);

  // set of checked container names, driving both the row checkboxes and the
  // confirm-enabled state.
  private readonly selected = signal<Set<string>>(new Set());

  protected readonly hasSelection = computed(() => this.selected().size > 0);

  constructor() {
    void this.store.runScan(this.context.deviceId);
  }

  cancel(): void {
    this.dialogRef.close();
  }

  async confirm(): Promise<void> {
    const checked = this.selected();
    const containers = (this.store.scan() ?? []).filter((container) => checked.has(container.containerName));
    if (containers.length === 0) {
      return;
    }
    this.submitting.set(true);
    this.errorMessage.set(null);
    const result = await this.store.addSelected(this.context.deviceId, containers);
    this.submitting.set(false);
    if (result.error) {
      this.errorMessage.set(result.error);
      return;
    }
    toast(containers.length === 1 ? '[+] added 1 service' : '[+] added ' + containers.length + ' services');
    this.dialogRef.close(true);
  }

  isSelected(container: ScannedContainer): boolean {
    return this.selected().has(container.containerName);
  }

  toggle(container: ScannedContainer, checked: boolean): void {
    this.selected.update((current) => {
      const next = new Set(current);
      if (checked) {
        next.add(container.containerName);
      } else {
        next.delete(container.containerName);
      }
      return next;
    });
  }
}
