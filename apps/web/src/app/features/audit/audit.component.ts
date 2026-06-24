import { DatePipe, NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { AuditClient } from '@app/features/audit/data/audit.client';
import { AuditStore } from '@app/features/audit/data/audit.store';
import { SynthesisCardComponent } from '@app/features/diagnosis/components/synthesis-card.component';
import { clientTable } from '@app/shared/client-table';
import { SortHeaderComponent } from '@app/shared/components/sort-header.component';
import { TablePaginationComponent } from '@app/shared/components/table-pagination.component';
import { ClickableDirective } from '@app/shared/directives/clickable.directive';
import { type AuditEvent } from '@opspilot/shared';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmInput } from '@spartan-ng/helm/input';
import { HlmSelectImports } from '@spartan-ng/helm/select';
import { HlmTableImports } from '@spartan-ng/helm/table';

// merged audit timeline (/audit) as a datatable: free-text search + an action column filter +
// sortable time/action headers + client pagination, newest-first by default. a run-linked row
// expands to the shared synthesis-card (the synthesis arrives inline via the server LEFT JOIN).
// store + client provided here (not providedIn: 'root', per angular.md).
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ...HlmTableImports,
    ...HlmSelectImports,
    ClickableDirective,
    DatePipe,
    HlmButton,
    HlmInput,
    NgTemplateOutlet,
    SortHeaderComponent,
    SynthesisCardComponent,
    TablePaginationComponent,
  ],
  providers: [AuditClient, AuditStore],
  selector: 'app-audit',
  templateUrl: './audit.component.html',
})
export class AuditComponent {
  protected readonly store = inject(AuditStore);

  // the shared datatable: newest-first by default, free-text search across action/target,
  // an action column filter, client pagination.
  protected readonly table = clientTable<AuditEvent>({
    filters: {
      action: (row, value) => row.action === value,
    },
    initialSort: { dir: 'desc', key: 'time' },
    searchText: (row) => `${row.action} ${row.targetType ?? ''} ${row.targetId ?? ''}`,
    sorters: {
      action: (row) => row.action,
      time: (row) => row.createdAt,
    },
    source: this.store.events,
  });

  // the action filter options, built from the distinct action values present in the loaded
  // events (so the select only offers actions the user actually has).
  protected readonly actionOptions = computed(() =>
    [...new Set(this.store.events().map((event) => event.action))].sort()
  );

  // the active action filter value, mirrored back onto the toolbar select.
  protected readonly actionFilter = computed(() => this.table.filterValues()['action'] ?? 'all');

  constructor() {
    void this.store.load();
  }

  // the Result column color: skill.run surfaces metadata.outcome (succeeded green / else red),
  // a run-linked row surfaces its synthesis status, everything else stays muted.
  resultClass(event: AuditEvent): string {
    if (event.action === 'skill.run') {
      const outcome = event.metadata?.['outcome'];
      if (outcome === 'succeeded') {
        return 'text-op-success-text';
      }
      return outcome ? 'text-op-danger-text' : 'text-op-mute';
    }
    switch (event.synthesis?.status) {
      case 'degraded':
        return 'text-op-warning-text';
      case 'down':
        return 'text-op-danger-text';
      case 'healthy':
        return 'text-op-success-text';
      default:
        return 'text-op-mute';
    }
  }

  // the Result column text: skill.run shows its outcome; a run-linked row shows its synthesis
  // status; a plain crud action has no result.
  resultText(event: AuditEvent): string {
    if (event.action === 'skill.run') {
      const outcome = event.metadata?.['outcome'];
      return typeof outcome === 'string' ? outcome : '';
    }
    return event.synthesis?.status ?? '';
  }
}
