import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { LlmProvidersClient } from '@app/features/llm-providers/data/llm-providers.client';
import { LlmProvidersStore } from '@app/features/llm-providers/data/llm-providers.store';
import {
  LlmProviderFormDialog,
  type LlmProviderFormDialogContext,
} from '@app/features/llm-providers/dialogs/llm-provider-form.dialog';
import { clickableClasses } from '@app/shared/directives/clickable-classes';
import { ClickableDirective } from '@app/shared/directives/clickable.directive';
import { type LlmProvider } from '@opspilot/shared';
import { toast } from '@spartan-ng/brain/sonner';
import { HlmAlertDialogImports } from '@spartan-ng/helm/alert-dialog';
import { HlmDialogService } from '@spartan-ng/helm/dialog';

// llm-provider config view (activate / edit / delete). store + client provided here (not providedIn: 'root', per angular.md); the form dialog gets the store via context since it renders in a cdk overlay outside this injector.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, ...HlmAlertDialogImports, ClickableDirective],
  providers: [LlmProvidersClient, LlmProvidersStore],
  selector: 'app-llm-providers',
  templateUrl: './llm-providers.component.html',
})
export class LlmProvidersComponent {
  private readonly dialog = inject(HlmDialogService);

  protected readonly store = inject(LlmProvidersStore);

  // op-* affordance for the alert-dialog confirm/cancel buttons; merged over hlmBtn's cva through classes()/twmerge.
  protected readonly dangerSolidAffordance = clickableClasses('danger-solid');

  protected readonly secondaryAffordance = clickableClasses('secondary');

  protected readonly providerToDelete = signal<LlmProvider | null>(null);

  constructor() {
    void this.store.load();
  }

  async activate(provider: LlmProvider): Promise<void> {
    const result = await this.store.activate(provider.id);
    toast(result.error ? '[x] could not activate provider' : '[+] provider is now active');
  }

  async confirmDelete(dialog: { close: () => void }): Promise<void> {
    const provider = this.providerToDelete();
    if (provider) {
      const result = await this.store.remove(provider.id);
      toast(result.error ? '[x] could not delete provider' : '[-] provider deleted');
    }
    dialog.close();
  }

  openCreate(): void {
    this.openForm('create', null);
  }

  openEdit(provider: LlmProvider): void {
    this.openForm('edit', provider);
  }

  requestDelete(provider: LlmProvider, dialog: { open: () => void }): void {
    this.providerToDelete.set(provider);
    dialog.open();
  }

  private openForm(mode: 'create' | 'edit', provider: LlmProvider | null): void {
    const context: LlmProviderFormDialogContext = { mode, provider, store: this.store };
    this.dialog.open(LlmProviderFormDialog, { context });
  }
}
