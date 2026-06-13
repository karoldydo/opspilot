import { Controller, Get, Inject, Query } from '@nestjs/common';
import { AuditEvent, AuditListQuery, auditListQuerySchema } from '@opspilot/shared';

import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { AuditService } from './audit.service';

// the read side of the audit log: one merged chronological timeline. thin
// controller — the query is clamped/validated at the boundary, the list logic
// (LEFT JOIN to run_record, pagination, synthesis attach) lives in the service.
// guarded by the global AuthAppGuard like every other operational endpoint.
@Controller('audit')
export class AuditController {
  constructor(@Inject(AuditService) private readonly auditService: AuditService) {}

  @Get()
  list(@Query(new ZodValidationPipe(auditListQuerySchema)) query: AuditListQuery): AuditEvent[] {
    return this.auditService.list(query);
  }
}
