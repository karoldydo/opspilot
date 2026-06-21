import { DATABASE_CONNECTION, DatabaseConnection } from '@api/core/database/providers/database-connection.provider';
import { auditLog } from '@api/core/database/schema/audit-log.schema';
import { runRecord } from '@api/core/database/schema/run-record.schema';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { AuditAction, AuditEvent, auditEventSchema, AuditListQuery } from '@opspilot/shared';
import { and, desc, eq, gte, lte } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';

// the joined row shape the list query projects (audit_log + the linked run's synthesis, null if none).
interface AuditListRow {
  action: string;
  createdAt: Date;
  id: string;
  metadata: null | string;
  runRecordId: null | string;
  synthesis: null | string;
  targetId: null | string;
  targetType: null | string;
  userId: string;
}

// one audit insert; secret-free metadata only (ids/labels — never plaintext keys).
interface AuditRecordInput {
  action: AuditAction;
  metadata?: null | Record<string, unknown>;
  runRecordId?: null | string;
  targetId?: null | string;
  targetType?: null | string;
  userId: string;
}

// the tx handle a tier-1 caller passes so the audit insert joins the action's own transaction (atomic).
type DatabaseTransaction = Parameters<Parameters<DatabaseConnection['transaction']>[0]>[0];

// default timeline page size when `limit` is omitted — a list-page default, not a config tunable.
const DEFAULT_LIST_LIMIT = 50;

// central audit writer + timeline reader; explicit @Inject token (lessons.md). better-sqlite3 is synchronous — no await.
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(@Inject(DATABASE_CONNECTION) private readonly db: DatabaseConnection) {}

  // merged timeline: audit_log LEFT JOIN run_record so run-linked rows carry their synthesis
  // inline (one query, no client-side union); newest-first, paginated, narrowable by action + window.
  list(query: AuditListQuery): AuditEvent[] {
    const conditions = [
      ...(query.action ? [eq(auditLog.action, query.action)] : []),
      ...(query.from ? [gte(auditLog.createdAt, new Date(query.from))] : []),
      ...(query.to ? [lte(auditLog.createdAt, new Date(query.to))] : []),
    ];
    const rows = this.db
      .select({
        action: auditLog.action,
        createdAt: auditLog.createdAt,
        id: auditLog.id,
        metadata: auditLog.metadata,
        runRecordId: auditLog.runRecordId,
        synthesis: runRecord.synthesis,
        targetId: auditLog.targetId,
        targetType: auditLog.targetType,
        userId: auditLog.userId,
      })
      .from(auditLog)
      .leftJoin(runRecord, eq(auditLog.runRecordId, runRecord.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(auditLog.createdAt))
      .limit(query.limit ?? DEFAULT_LIST_LIMIT)
      .offset(query.offset)
      .all();
    return rows.map((row) => this.toContract(row));
  }

  // insert one audit row. tier-1 callers pass `tx` so it commits with the action; tier-2 omit
  // it (base connection). passing base `db` would run a separate implicit transaction and break atomicity.
  record(input: AuditRecordInput, tx?: DatabaseTransaction): void {
    // audit_log.userId is NOT NULL but @CurrentUserId() can be undefined on a misconfigured
    // @Public route — fail fast with a named error, not a raw not-null constraint from the driver.
    if (!input.userId) {
      throw new Error(`cannot record ${input.action} audit row: missing userId`);
    }
    (tx ?? this.db)
      .insert(auditLog)
      .values({
        action: input.action,
        id: randomUUID(),
        metadata: input.metadata == null ? null : JSON.stringify(input.metadata),
        runRecordId: input.runRecordId ?? null,
        targetId: input.targetId ?? null,
        targetType: input.targetType ?? null,
        userId: input.userId,
      })
      .run();
  }

  // tier-2 best-effort: the op already succeeded, so a failed audit insert must not turn it
  // into a 500 — log and swallow. tier-1 callers use record(input, tx) so failures roll back.
  recordOnInvocation(input: AuditRecordInput): void {
    try {
      this.record(input);
    } catch (error) {
      this.logger.error(`failed to record ${input.action} audit row for user ${input.userId}`, error);
    }
  }

  private toContract(row: AuditListRow): AuditEvent {
    return auditEventSchema.parse({
      action: row.action,
      createdAt: row.createdAt,
      id: row.id,
      metadata: row.metadata === null ? null : JSON.parse(row.metadata),
      runRecordId: row.runRecordId,
      targetId: row.targetId,
      targetType: row.targetType,
      userId: row.userId,
      ...(row.synthesis === null ? {} : { synthesis: JSON.parse(row.synthesis) }),
    });
  }
}
