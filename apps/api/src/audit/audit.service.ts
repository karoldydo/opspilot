import { DATABASE_CONNECTION, DatabaseConnection } from '@api/database/providers/database-connection.provider';
import { auditLog } from '@api/database/schema/audit-log.schema';
import { runRecord } from '@api/database/schema/run-record.schema';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { AuditAction, AuditEvent, auditEventSchema, AuditListQuery } from '@opspilot/shared';
import { and, desc, eq, gte, lte } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';

// the joined row shape the list query projects (audit_log columns + the linked
// run's synthesis text, null when the row has no run).
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

// the drizzle transaction handle a tier-1 caller passes so the audit insert joins
// the action's own transaction (atomic). derived from the connection's transaction
// callback param — both the connection and a tx expose insert/select.
type DatabaseTransaction = Parameters<Parameters<DatabaseConnection['transaction']>[0]>[0];

// default timeline page size when the caller omits `limit` — mirrors the inline
// default on RunRecordService.findRecent (a list page default, not a config tunable).
const DEFAULT_LIST_LIMIT = 50;

// central audit writer + timeline reader. explicit @Inject token (esbuild/vitest
// drops design:paramtypes, lessons.md). better-sqlite3 is synchronous — no await.
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(@Inject(DATABASE_CONNECTION) private readonly db: DatabaseConnection) {}

  // the merged chronological timeline: audit_log LEFT JOIN run_record so run-linked
  // rows carry their saved synthesis inline (one query, no client-side union).
  // newest-first, paginated, optionally narrowed by action and a createdAt window.
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

  // insert one audit row. tier-1 callers pass their own `tx` so the audit insert
  // commits or rolls back with the action; tier-2 callers omit it (record on
  // invocation, base connection). passing base `db` instead of `tx` would run the
  // insert in a separate implicit transaction and break the atomic guarantee.
  record(input: AuditRecordInput, tx?: DatabaseTransaction): void {
    // audit_log.userId is NOT NULL and @CurrentUserId() resolves to string | undefined
    // (it would be undefined only on a misconfigured @Public route). fail fast with a
    // named error rather than letting a raw not-null constraint surface from the driver.
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

  // tier-2 best-effort write: the side-effect op (skill.run / service.scan /
  // diagnose.run) has already succeeded by the time we record, so a failed audit
  // insert must not turn a successful op into a 500 — log and swallow. tier-1 callers
  // keep using record(input, tx) directly so a failed insert still rolls the action back.
  recordOnInvocation(input: AuditRecordInput): void {
    try {
      this.record(input);
    } catch (error) {
      this.logger.error(`failed to record ${input.action} audit row for user ${input.userId}`, error);
    }
  }

  // project safe fields through the shared contract: parse the metadata/synthesis
  // json, attach synthesis only for run-linked rows, and let isoTimestamp normalize
  // the timestamp_ms date to an iso string. never spread the raw row.
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
