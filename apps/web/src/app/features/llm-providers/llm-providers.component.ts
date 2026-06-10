import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { type LlmProvider } from '@opspilot/shared';
import { HlmAlertDialogImports } from '@spartan-ng/helm/alert-dialog';
import { HlmBadge } from '@spartan-ng/helm/badge';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmDialogService } from '@spartan-ng/helm/dialog';
import { HlmEmptyImports } from '@spartan-ng/helm/empty';
import { HlmTableImports } from '@spartan-ng/helm/table';

import { LlmProvidersClient } from '../../core/clients/llm-providers.client';
import { LlmProvidersStore } from '../../core/stores/llm-providers.store';
import { LlmProviderFormDialog, type LlmProviderFormDialogContext } from './llm-provider-form.dialog';

// the llm-provider configuration view: a table of every configured provider with an
// active badge + an "activate" action, edit/delete row actions, an empty state, and
// an add button. all data fetching lives in the store; the component only opens
// dialogs and reads signals. the store + client are provided here (not
// providedIn: 'root', per angular.md) so the lazy feature owns their lifecycle; the
// form dialog renders in a cdk overlay outside this injector, so the list passes the
// store instance via dialog context.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, HlmBadge, HlmButton, ...HlmTableImports, ...HlmAlertDialogImports, ...HlmEmptyImports],
  providers: [LlmProvidersClient, LlmProvidersStore],
  selector: 'app-llm-providers',
  templateUrl: './llm-providers.component.html',
})
export class LlmProvidersComponent {
  private readonly dialog = inject(HlmDialogService);

  protected readonly store = inject(LlmProvidersStore);

  // the provider a pending delete confirmation refers to — drives the alert-dialog copy.
  protected readonly providerToDelete = signal<LlmProvider | null>(null);

  constructor() {
    void this.store.load();
  }

  async activate(provider: LlmProvider): Promise<void> {
    await this.store.activate(provider.id);
  }

  async confirmDelete(dialog: { close: () => void }): Promise<void> {
    const provider = this.providerToDelete();
    if (provider) {
      await this.store.remove(provider.id);
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
