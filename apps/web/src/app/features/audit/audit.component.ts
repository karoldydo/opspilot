import { DatePipe, NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { AuditClient } from '@app/features/audit/data/audit.client';
import { AuditStore } from '@app/features/audit/data/audit.store';
import { ClickableDirective } from '@app/shared/directives/clickable.directive';
import { type DiagnosisSynthesis } from '@opspilot/shared';

// status → terminal status-chip classes: status-fill background with cream text, mirroring the fleet table.
const BADGE_CLASS: Record<DiagnosisSynthesis['status'], string> = {
  degraded: 'bg-op-warning text-op-cream',
  down: 'bg-op-danger text-op-cream',
  healthy: 'bg-op-success-text text-op-cream',
};

// merged audit timeline (/audit), newest-first from audit_log; a run-linked row expands to its saved synthesis card (the synthesis arrives inline via the server LEFT JOIN). store + client provided here (not providedIn: 'root', per angular.md).
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, NgTemplateOutlet, ClickableDirective],
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
