import { DATABASE_CONNECTION, DatabaseConnection } from '@api/core/database/providers/database-connection.provider';
import { skill } from '@api/core/database/schema/skill.schema';
import { AuditService } from '@api/modules/audit/audit.service';
import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Skill, SkillCreateRequest, skillCreateRequestSchema, skillSchema, SkillUpdateRequest } from '@opspilot/shared';
import { and, eq, isNull, or, SQL } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';

type SkillRow = typeof skill.$inferSelect;
// the tx query runner — the uniqueness read + the write share it so check-then-write is atomic.
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
    // uniqueness-per-scope is read-then-write: conflict check + insert share one transaction
    // so two concurrent creates can't both pass and insert the same name in scope (lessons.md).
    const row = this.db.transaction((tx) => {
      this.assertNameUniqueInScope(tx, input.name, deviceId);
      const inserted = tx
        .insert(skill)
        .values({
          commandTemplate: input.commandTemplate,
          deviceId,
          id: randomUUID(),
          name: input.name,
          // parameters persist as json text (sqlite has no array type); toContract parses it back.
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

  // scope-aware query: a device sees its own skills plus every global one
  // (or(isNull, eq) is the runtime scope filter).
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
      // merge the patch onto the stored row: the parity/uniqueness invariant spans both
      // commandTemplate and parameters, so a partial patch is checked against the merged shape.
      const name = input.name ?? existing.name;
      const deviceId = input.deviceId !== undefined ? input.deviceId : existing.deviceId;
      const commandTemplate = input.commandTemplate ?? existing.commandTemplate;
      const parameters = input.parameters ?? (JSON.parse(existing.parameters) as SkillCreateRequest['parameters']);
      const timeoutMs = input.timeoutMs !== undefined ? input.timeoutMs : existing.timeoutMs;
      // re-validate the merged result against the create shape so the {{placeholder}} ↔ parameter
      // parity still holds after a partial patch (the schema is the single source of that rule); a
      // violation throws ZodError → 400.
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

  // conflict if another row holds this name in the same scope; excludeId lets update skip itself.
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

  // read the row or 404 (nestjs.md); optional tx so update reads through the same runner as its write.
  private requireRow(id: string, tx: DatabaseConnection | SkillTx = this.db): SkillRow {
    const row = tx.select().from(skill).where(eq(skill.id, id)).get();
    if (!row) {
      throw new NotFoundException(`skill ${id} not found`);
    }
    return row;
  }

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
