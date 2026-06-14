import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { AuditClient } from '@app/features/audit/data/audit.client';
import { AuditStore } from '@app/features/audit/data/audit.store';
import { type DiagnosisSynthesis } from '@opspilot/shared';
import { HlmBadge } from '@spartan-ng/helm/badge';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmCardImports } from '@spartan-ng/helm/card';
import { HlmEmptyImports } from '@spartan-ng/helm/empty';
import { HlmTableImports } from '@spartan-ng/helm/table';

// status → badge classes. spartan's hlmBadge has no success/warning variant, so we
// keep its shape and color via tokens/utilities — mirrors device-services.component.
const BADGE_CLASS: Record<DiagnosisSynthesis['status'], string> = {
  degraded: 'border-transparent bg-amber-500/15 text-amber-700 dark:text-amber-500',
  down: 'border-transparent bg-destructive/15 text-destructive',
  healthy: 'border-transparent bg-green-600/15 text-green-700 dark:text-green-400',
};

// the merged audit timeline view (/audit): one chronological list driven by
// audit_log, newest-first. a run-linked row (its synthesis came inline via the
// server LEFT JOIN) expands to the saved synthesis card — the same renderer s-05
// uses for replay. all data fetching lives in the store; the component only reads
// signals and toggles the expanded row. store + client are provided here (not
// providedIn: 'root', per angular.md) so the lazy feature owns their lifecycle.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, HlmBadge, HlmButton, ...HlmCardImports, ...HlmEmptyImports, ...HlmTableImports],
  providers: [AuditClient, AuditStore],
  selector: 'app-audit',
  templateUrl: './audit.component.html',
})
export class AuditComponent {
  protected readonly store = inject(AuditStore);

  constructor() {
    void this.store.load();
  }

  // badge classes for a synthesis status — drives the expanded card's status chip.
  badgeClass(status: DiagnosisSynthesis['status']): string {
    return BADGE_CLASS[status];
  }
}
