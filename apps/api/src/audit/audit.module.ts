import { Module } from '@nestjs/common';

import { AuditService } from './audit.service';

// central audit writer, exported to every feature module that records an action.
// the audit controller (the read timeline) and its json() middleware re-apply land
// in phase 4 — phase 1 ships the service only.
@Module({
  exports: [AuditService],
  providers: [AuditService],
})
export class AuditModule {}
