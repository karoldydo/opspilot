import { llmConfig, LlmConfig } from '@api/config/llm.config';
import { DATABASE_CONNECTION, DatabaseConnection } from '@api/core/database/providers/database-connection.provider';
import { runRecord } from '@api/core/database/schema/run-record.schema';
import { Inject, Injectable } from '@nestjs/common';
import { DiagnosisSynthesis, RunRecord, runRecordSchema } from '@opspilot/shared';
import { and, desc, eq, notInArray } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';

// input the diagnose stream hands over once synthesis is final. userId is nullable here
// (s-09) and never surfaced in the s-05 wire contract.
interface RunRecordCreate {
  deviceId: string;
  // wall-clock ms the synthesis generation took; omitted leaves the column null.
  durationMs?: number;
  serviceId: string;
  synthesis: DiagnosisSynthesis;
  userId?: string;
}

type RunRecordRow = typeof runRecord.$inferSelect;

@Injectable()
export class RunRecordService {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: DatabaseConnection,
    @Inject(llmConfig.KEY) private readonly config: LlmConfig
  ) {}

  // insert + prune older runs beyond the retention bound in one transaction
  // (compute-then-write invariant, lessons.md): the keep-set read and the delete
  // must not race a concurrent insert.
  create(input: RunRecordCreate): RunRecord {
    const row = this.db.transaction((tx) => {
      const inserted = tx
        .insert(runRecord)
        .values({
          deviceId: input.deviceId,
          durationMs: input.durationMs,
          id: randomUUID(),
          serviceId: input.serviceId,
          synthesis: JSON.stringify(input.synthesis),
          userId: input.userId,
        })
        .returning()
        .get();
      const keepIds = tx
        .select({ id: runRecord.id })
        .from(runRecord)
        .where(eq(runRecord.serviceId, input.serviceId))
        .orderBy(desc(runRecord.createdAt))
        .limit(this.config.historyRetention)
        .all()
        .map((r) => r.id);
      tx.delete(runRecord)
        .where(and(eq(runRecord.serviceId, input.serviceId), notInArray(runRecord.id, keepIds)))
        .run();
      return inserted;
    });
    return this.toContract(row);
  }

  findRecent(deviceId: string, serviceId: string, limit = 20, offset = 0): RunRecord[] {
    const rows = this.db
      .select()
      .from(runRecord)
      .where(and(eq(runRecord.deviceId, deviceId), eq(runRecord.serviceId, serviceId)))
      .orderBy(desc(runRecord.createdAt))
      .limit(limit)
      .offset(offset)
      .all();
    return rows.map((row) => this.toContract(row));
  }

  // userId is deliberately not projected — it never crosses the s-05 wire contract.
  private toContract(row: RunRecordRow): RunRecord {
    return runRecordSchema.parse({
      createdAt: row.createdAt,
      deviceId: row.deviceId,
      id: row.id,
      serviceId: row.serviceId,
      synthesis: JSON.parse(row.synthesis),
      // omit (not null) when absent so the optional contract field stays unset.
      ...(row.durationMs == null ? {} : { durationMs: row.durationMs }),
    });
  }
}
