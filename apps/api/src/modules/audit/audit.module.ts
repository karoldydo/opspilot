import { Module } from '@nestjs/common';

import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';

// central audit writer + the read timeline. the service is exported to every
// feature module that records an action; the controller serves GET /api/audit
// (read-only, no body — so no json() middleware re-apply needed).
@Module({
  controllers: [AuditController],
  exports: [AuditService],
  providers: [AuditService],
})
export class AuditModule {}
