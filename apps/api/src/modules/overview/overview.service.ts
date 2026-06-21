import { overviewConfig, OverviewConfig } from '@api/config/overview.config';
import { DATABASE_CONNECTION, DatabaseConnection } from '@api/core/database/providers/database-connection.provider';
import { auditLog } from '@api/core/database/schema/audit-log.schema';
import { runRecord } from '@api/core/database/schema/run-record.schema';
import { Inject, Injectable } from '@nestjs/common';
import { OverviewMetrics, overviewMetricsSchema } from '@opspilot/shared';
import { and, eq, gte, isNotNull } from 'drizzle-orm';

// the skill.run audit metadata shape (skill-run.service.ts) — only `outcome` matters here.
interface SkillRunMetadata {
  outcome?: string;
}

// serves the two overview tiles that have no other backing source (frame.md gaps),
// both scoped to the authed user and derived from existing tables — no new table.
// the skill-runs tile counts a trailing window; the avg-diagnose tile averages a wider
// window so a single fast/slow run doesn't whip the number around — both config-tunable
// (lessons.md). better-sqlite3 is synchronous, so no await ceremony. explicit @Inject tokens.
@Injectable()
export class OverviewService {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: DatabaseConnection,
    @Inject(overviewConfig.KEY) private readonly config: OverviewConfig
  ) {}

  metrics(userId: string): OverviewMetrics {
    return overviewMetricsSchema.parse({
      avgDiagnoseMs: this.avgDiagnoseMs(userId),
      skillRuns24h: this.skillRuns24h(userId),
    });
  }

  // average run_record.durationMs over the recent window, scoped to the user. rows
  // predating the durationMs column (or aborted before persist) read null and are
  // excluded; null when no qualifying run exists.
  private avgDiagnoseMs(userId: string): null | number {
    const cutoff = new Date(Date.now() - this.config.avgDiagnoseWindowMs);
    const rows = this.db
      .select({ durationMs: runRecord.durationMs })
      .from(runRecord)
      .where(and(eq(runRecord.userId, userId), isNotNull(runRecord.durationMs), gte(runRecord.createdAt, cutoff)))
      .all();
    if (rows.length === 0) {
      return null;
    }
    const total = rows.reduce((sum, row) => sum + (row.durationMs ?? 0), 0);
    return Math.round(total / rows.length);
  }

  // count + success-rate of skill.run audit rows in the trailing 24h, scoped to the
  // user. success-rate is metadata.outcome === 'succeeded' over the count (0 when none).
  private skillRuns24h(userId: string): OverviewMetrics['skillRuns24h'] {
    const cutoff = new Date(Date.now() - this.config.skillRunsWindowMs);
    const rows = this.db
      .select({ metadata: auditLog.metadata })
      .from(auditLog)
      .where(and(eq(auditLog.userId, userId), eq(auditLog.action, 'skill.run'), gte(auditLog.createdAt, cutoff)))
      .all();
    const count = rows.length;
    if (count === 0) {
      return { count: 0, successRate: 0 };
    }
    const succeeded = rows.filter((row) => {
      if (row.metadata === null) {
        return false;
      }
      // metadata is an opaque blob (audit-log.schema) and rows can predate the
      // current shape — a single malformed row must not 500 the whole tile, so a
      // parse failure counts as "not succeeded" rather than throwing.
      try {
        const parsed = JSON.parse(row.metadata) as SkillRunMetadata;
        return parsed.outcome === 'succeeded';
      } catch {
        return false;
      }
    }).length;
    return { count, successRate: succeeded / count };
  }
}
