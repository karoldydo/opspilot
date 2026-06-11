import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { type Service, type ServiceOperation } from '@opspilot/shared';
import { HlmAlertDialogImports } from '@spartan-ng/helm/alert-dialog';
import { HlmButton } from '@spartan-ng/helm/button';

import { ServiceOperationsClient } from '../../core/clients/service-operations.client';
import { ServiceOperationsStore } from '../../core/stores/service-operations.store';

// button labels for the 5 fixed ops — kept off the template so the markup stays
// property-access only (angular.md). running state flips to a shared 'Running…'.
const OP_LABEL: Record<ServiceOperation, string> = {
  down: 'Down',
  restart: 'Restart',
  start: 'Start',
  stop: 'Stop',
  up: 'Up',
};

// the op affordance for one service row, extracted so DeviceServicesComponent does
// not grow past its line budget. owns its own client + store (provided here, not
// providedIn: 'root', per angular.md) keyed by serviceId so one row's pending/result
// never bleeds into another. the 3 container-scoped ops render on every service; up/
// down render only on a compose-managed service. down is destructive (removes
// containers + the network) so it gates behind an alert-dialog confirm before running.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  // display: contents so the inner block participates directly in the actions
  // cell's flex row rather than nesting a stray inline host box.
  host: { class: 'contents' },
  imports: [HlmButton, ...HlmAlertDialogImports],
  providers: [ServiceOperationsClient, ServiceOperationsStore],
  selector: 'app-service-operations',
  templateUrl: './service-operations.component.html',
})
export class ServiceOperationsComponent {
  readonly deviceId = input.required<string>();

  readonly service = input.required<Service>();

  protected readonly store = inject(ServiceOperationsStore);

  // up/down only make sense on a compose-managed service — both scan-derived fields
  // must be present (a standalone container has them null).
  protected readonly canCompose = computed(() => !!this.service().composePath && !!this.service().composeProject);

  // the always-present container-scoped ops, in display order.
  protected readonly containerOps: ServiceOperation[] = ['start', 'stop', 'restart'];

  // this row's current op slice (pending/result/error); reads the store signal so
  // the template tracks it.
  protected readonly entry = computed(() => this.store.entry(this.service().id));

  protected readonly opLabel = OP_LABEL;

  // runs the confirmed down op then closes the dialog — mirrors confirmDelete.
  async confirmDown(dialog: { close: () => void }): Promise<void> {
    await this.run('down');
    dialog.close();
  }

  // fires a non-destructive op immediately; the store flips pending so the button
  // disables + shows the running label until the synchronous op confirms.
  run(operation: ServiceOperation): Promise<void> {
    return this.store.run(this.deviceId(), this.service().id, operation);
  }
}
