import { DATABASE_CONNECTION, DatabaseConnection } from '@api/database/providers/database-connection.provider';
import { skill } from '@api/database/schema/skill.schema';
import { Inject, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { SkillParameter } from '@opspilot/shared';
import { isNull } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';

// a service-bound parameter is read server-side from the resolved service row at run
// time and never trusted from the client — the lifecycle ops use these exclusively,
// so their run request carries no inputs.
const serviceParameter = (name: string): SkillParameter => ({ name, required: true, source: 'service' });

// the five lifecycle ops, migrated from the hardcoded operation/ switch
// (operation.service.ts:66-82) onto global skill rows (deviceId = null). container
// ops template {{containerName}}; compose ops template both {{composePath}} and
// {{composeProject}} so the project name is not silently re-derived. the PATH prefix
// is prepended by the renderer at run time (phase 4), not stored in the template.
const LIFECYCLE_SKILLS: Pick<typeof skill.$inferInsert, 'commandTemplate' | 'name' | 'parameters'>[] = [
  {
    commandTemplate: 'docker start {{containerName}}',
    name: 'start',
    parameters: JSON.stringify([serviceParameter('containerName')]),
  },
  {
    commandTemplate: 'docker stop {{containerName}}',
    name: 'stop',
    parameters: JSON.stringify([serviceParameter('containerName')]),
  },
  {
    commandTemplate: 'docker restart {{containerName}}',
    name: 'restart',
    parameters: JSON.stringify([serviceParameter('containerName')]),
  },
  {
    commandTemplate: 'docker compose -f {{composePath}} -p {{composeProject}} up -d',
    name: 'up',
    parameters: JSON.stringify([serviceParameter('composePath'), serviceParameter('composeProject')]),
  },
  {
    commandTemplate: 'docker compose -f {{composePath}} -p {{composeProject}} down',
    name: 'down',
    parameters: JSON.stringify([serviceParameter('composePath'), serviceParameter('composeProject')]),
  },
];

@Injectable()
export class SkillSeedService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SkillSeedService.name);

  // explicit @Inject token — esbuild/vitest drops design:paramtypes so type-only di
  // resolves to undefined at runtime (lessons.md).
  constructor(@Inject(DATABASE_CONNECTION) private readonly db: DatabaseConnection) {}

  // runs after migrations apply (databasemodule is @global, so its migrationservice
  // bootstrap hook fires before this feature module's). idempotent: insert-if-absent
  // by name within the global scope (deviceId null), so a re-boot never duplicates.
  // read + write in one transaction so a concurrent boot can't double-insert.
  onApplicationBootstrap(): void {
    const seeded = this.db.transaction((tx) => {
      const existing = new Set(
        tx
          .select({ name: skill.name })
          .from(skill)
          .where(isNull(skill.deviceId))
          .all()
          .map((row) => row.name)
      );
      const missing = LIFECYCLE_SKILLS.filter((definition) => !existing.has(definition.name));
      for (const definition of missing) {
        tx.insert(skill)
          .values({ ...definition, deviceId: null, id: randomUUID() })
          .run();
      }
      return missing.length;
    });
    if (seeded > 0) {
      this.logger.log(`seeded ${seeded} global lifecycle skill(s)`);
    }
  }
}
