import { llmConfig, LlmConfig } from '@api/config/llm.config';
import { DATABASE_CONNECTION, DatabaseConnection } from '@api/core/database/providers/database-connection.provider';
import { runRecord } from '@api/core/database/schema/run-record.schema';
import { Inject, Injectable } from '@nestjs/common';
import { DiagnosisSynthesis, RunRecord, runRecordSchema } from '@opspilot/shared';
import { and, desc, eq, notInArray } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';

// the input the diagnose stream hands over once the synthesis is final. userId is
// the authenticated session user persisted on the run (s-09); the column is
// nullable so it stays optional here (the diagnose flow threads the real id in
// phase 3), and it is still never surfaced in the s-05 wire contract.
interface RunRecordCreate {
  deviceId: string;
  serviceId: string;
  synthesis: DiagnosisSynthesis;
  userId?: string;
}

type RunRecordRow = typeof runRecord.$inferSelect;

// persist a completed diagnose run and read the recent runs for a service row.
// crud shape mirrors LlmProviderService — explicit @Inject tokens (esbuild drops
// design:paramtypes, see lessons.md), local unexported row type, randomUUID ids,
// project safe fields through the shared zod contract before returning.
@Injectable()
export class RunRecordService {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: DatabaseConnection,
    @Inject(llmConfig.KEY) private readonly config: LlmConfig
  ) {}

  // insert the completed run and prune older runs for the same service beyond the
  // retention bound — both in one transaction (compute-then-write invariant,
  // lessons.md): the keep-set read and the delete must not race a concurrent
  // insert into a stale view of the table.
  create(input: RunRecordCreate): RunRecord {
    const row = this.db.transaction((tx) => {
      const inserted = tx
        .insert(runRecord)
        .values({
          deviceId: input.deviceId,
          id: randomUUID(),
          serviceId: input.serviceId,
          synthesis: JSON.stringify(input.synthesis),
          userId: input.userId,
        })
        .returning()
        .get();
      // keep the newest `historyRetention` rows for this service, delete the rest.
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

  // recent runs for a service row, newest-first and bounded (drizzle.md: paginate
  // every list query). scoped by both deviceId and serviceId so a run only surfaces
  // for the device that owns the service.
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

  // project safe fields only (never spread the row, never surface userId), parse
  // the stored synthesis json, and validate through the shared contract which
  // normalizes the timestamp_ms date to an iso string.
  private toContract(row: RunRecordRow): RunRecord {
    return runRecordSchema.parse({
      createdAt: row.createdAt,
      deviceId: row.deviceId,
      id: row.id,
      serviceId: row.serviceId,
      synthesis: JSON.parse(row.synthesis),
    });
  }
}
