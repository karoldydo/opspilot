import { AuditService } from '@api/audit/audit.service';
import { DATABASE_CONNECTION, DatabaseConnection } from '@api/core/database/providers/database-connection.provider';
import { skill } from '@api/core/database/schema/skill.schema';
import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Skill, SkillCreateRequest, skillCreateRequestSchema, skillSchema, SkillUpdateRequest } from '@opspilot/shared';
import { and, eq, isNull, or, SQL } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';

type SkillRow = typeof skill.$inferSelect;
// the query runner inside db.transaction(...) — same query api as the connection;
// the uniqueness read + the write must share it so the check-then-write is atomic.
type SkillTx = Parameters<Parameters<DatabaseConnection['transaction']>[0]>[0];

@Injectable()
export class SkillService {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: DatabaseConnection,
    @Inject(AuditService) private readonly auditService: AuditService
  ) {}

  async create(input: SkillCreateRequest, userId: string): Promise<Skill> {
    // null deviceId = global scope; a uuid scopes the skill to one device.
    const deviceId = input.deviceId ?? null;
    // uniqueness-per-scope is a read-then-write invariant — the conflict check and
    // the insert share one transaction so two concurrent creates can't both pass
    // the check and both insert the same name in the same scope (lessons.md:34-38).
    const row = this.db.transaction((tx) => {
      this.assertNameUniqueInScope(tx, input.name, deviceId);
      const inserted = tx
        .insert(skill)
        .values({
          commandTemplate: input.commandTemplate,
          deviceId,
          id: randomUUID(),
          name: input.name,
          // parameters persist as serialized json text (sqlite has no array type);
          // toContract parses it back into the array on read.
          parameters: JSON.stringify(input.parameters),
          timeoutMs: input.timeoutMs ?? null,
        })
        .returning()
        .get();
      // join the existing transaction so the audit row commits with the skill.
      this.auditService.record(
        {
          action: 'skill.create',
          metadata: { name: inserted.name },
          targetId: inserted.id,
          targetType: 'skill',
          userId,
        },
        tx
      );
      return inserted;
    });
    return this.toContract(row);
  }

  async findAll(): Promise<Skill[]> {
    const rows = this.db.select().from(skill).all();
    return rows.map((row) => this.toContract(row));
  }

  // the scope-aware query the run path and the web list consume: a device sees its
  // own skills plus every global one. the or(isNull, eq) predicate is the runtime
  // scope filter that did not exist anywhere before s-08.
  async findForDevice(deviceId: string): Promise<Skill[]> {
    const rows = this.db
      .select()
      .from(skill)
      .where(or(isNull(skill.deviceId), eq(skill.deviceId, deviceId)))
      .all();
    return rows.map((row) => this.toContract(row));
  }

  async findOne(id: string): Promise<Skill> {
    return this.toContract(this.requireRow(id));
  }

  async update(id: string, input: SkillUpdateRequest, userId: string): Promise<Skill> {
    const row = this.db.transaction((tx) => {
      const existing = this.requireRow(id, tx);
      // merge the patch onto the stored row (drizzle ignores undefined, but the
      // parity/uniqueness invariant spans both commandTemplate and parameters, so
      // a partial patch carrying only one must be checked against the merged shape).
      const name = input.name ?? existing.name;
      const deviceId = input.deviceId !== undefined ? input.deviceId : existing.deviceId;
      const commandTemplate = input.commandTemplate ?? existing.commandTemplate;
      const parameters = input.parameters ?? (JSON.parse(existing.parameters) as SkillCreateRequest['parameters']);
      const timeoutMs = input.timeoutMs !== undefined ? input.timeoutMs : existing.timeoutMs;
      // re-validate the merged result against the create shape so the {{placeholder}}
      // ↔ parameter parity (and name-uniqueness within the params) still holds after
      // a partial patch — skill-create-request.schema.ts is the single source of the
      // parity rule. a violation throws a zoderror the global filter shapes into 400.
      skillCreateRequestSchema.parse({ commandTemplate, deviceId, name, parameters, timeoutMs });
      // name-uniqueness within the (possibly changed) scope, excluding this row.
      this.assertNameUniqueInScope(tx, name, deviceId, id);
      // project explicit columns (never spread the dto); serialize parameters to json.
      const updated = tx
        .update(skill)
        .set({ commandTemplate, deviceId, name, parameters: JSON.stringify(parameters), timeoutMs })
        .where(eq(skill.id, id))
        .returning()
        .get();
      // join the existing transaction so the audit row commits with the skill.
      this.auditService.record(
        { action: 'skill.update', metadata: { name: updated.name }, targetId: id, targetType: 'skill', userId },
        tx
      );
      return updated;
    });
    return this.toContract(row);
  }

  async remove(id: string, userId: string): Promise<void> {
    const existing = this.requireRow(id);
    this.db.transaction((tx) => {
      tx.delete(skill).where(eq(skill.id, id)).run();
      this.auditService.record(
        { action: 'skill.delete', metadata: { name: existing.name }, targetId: id, targetType: 'skill', userId },
        tx
      );
    });
  }

  // conflict if another row already holds this name in the same scope (global vs a
  // given device). the scope predicate is isNull(deviceId) for global, eq otherwise;
  // excludeId lets update skip the row it is editing.
  private assertNameUniqueInScope(tx: SkillTx, name: string, deviceId: null | string, excludeId?: string): void {
    const scopePredicate: SQL = deviceId === null ? isNull(skill.deviceId) : eq(skill.deviceId, deviceId);
    const clash = tx
      .select({ id: skill.id })
      .from(skill)
      .where(and(eq(skill.name, name), scopePredicate))
      .all()
      .find((candidate) => candidate.id !== excludeId);
    if (clash) {
      const scope = deviceId === null ? 'global scope' : `device ${deviceId}`;
      throw new ConflictException(`skill ${name} already exists in ${scope}`);
    }
  }

  // read the row or fail with an entity-naming 404 (nestjs.md error rule). accepts an
  // optional tx so the update transaction reads through the same runner as its write.
  private requireRow(id: string, tx: DatabaseConnection | SkillTx = this.db): SkillRow {
    const row = tx.select().from(skill).where(eq(skill.id, id)).get();
    if (!row) {
      throw new NotFoundException(`skill ${id} not found`);
    }
    return row;
  }

  // project safe fields only (never spread the row) and validate through the shared
  // contract, which normalizes the timestamp_ms dates to iso strings. parameters are
  // stored as json text and parsed back into the typed array here.
  private toContract(row: SkillRow): Skill {
    return skillSchema.parse({
      commandTemplate: row.commandTemplate,
      createdAt: row.createdAt,
      deviceId: row.deviceId,
      id: row.id,
      name: row.name,
      parameters: JSON.parse(row.parameters),
      timeoutMs: row.timeoutMs,
      updatedAt: row.updatedAt,
    });
  }
}
