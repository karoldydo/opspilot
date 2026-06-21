import { AllExceptionsFilter } from '@api/common/filters/all-exceptions.filter';
import { ConfigModule } from '@api/config/config.module';
import { databaseConfig } from '@api/config/database.config';
import { DatabaseModule } from '@api/core/database/database.module';
import { DATABASE_CONNECTION, DatabaseConnection } from '@api/core/database/providers/database-connection.provider';
import { user } from '@api/core/database/schema/auth.schema';
import { INestApplication } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import request from 'supertest';

import { SkillModule } from './skill.module';

// guard faked here; real auth boundary is covered in auth.guard.spec.ts / auth.boundary.spec.ts
// SkillModule seeds five lifecycle skills on boot; assertions key off the created skill, not list length.
describe('SkillController (e2e)', () => {
  const userId = 'user-skill-ctrl-test';

  let moduleRef: TestingModule;
  let app: INestApplication;
  let db: DatabaseConnection;
  let dbPath: string;

  const globalSkill = {
    commandTemplate: 'docker logs {{tail}}',
    name: 'logs',
    parameters: [{ name: 'tail', required: true, source: 'input' }],
  };

  function cleanupTempFiles(): void {
    const dir = dirname(dbPath);
    const base = basename(dbPath);
    for (const file of readdirSync(dir)) {
      if (file.startsWith(base)) {
        rmSync(join(dir, file));
      }
    }
  }

  beforeEach(async () => {
    dbPath = join(tmpdir(), `opspilot-skill-ctrl-test-${process.pid}-${Date.now()}.db`);
    moduleRef = await Test.createTestingModule({
      imports: [ConfigModule, DatabaseModule, SkillModule],
      providers: [{ provide: APP_FILTER, useClass: AllExceptionsFilter }],
    })
      .overrideProvider(databaseConfig.KEY)
      .useValue({ backupRetention: 5, path: dbPath })
      .compile();
    app = moduleRef.createNestApplication();
    // fake the guard's session so @CurrentUserId resolves for the audit writes.
    app.use((req: { session?: { user: { id: string } } }, _res: unknown, next: () => void) => {
      req.session = { user: { id: userId } };
      next();
    });
    // app.init() triggers onApplicationBootstrap: migrations apply, then the seed runs.
    await app.init();
    db = moduleRef.get<DatabaseConnection>(DATABASE_CONNECTION);
    // seed the audit fk target — audit_log.userId references user.id.
    db.insert(user).values({ email: 'u1@example.com', id: userId, name: 'u1' }).run();
  });

  afterEach(async () => {
    await app?.close();
    cleanupTempFiles();
  });

  const server = () => app.getHttpServer();

  it('creates, fetches, updates and deletes a skill', async () => {
    const created = await request(server()).post('/skills').send(globalSkill).expect(201);
    expect(created.body).toEqual({
      commandTemplate: 'docker logs {{tail}}',
      createdAt: expect.any(String),
      deviceId: null,
      id: expect.any(String),
      name: 'logs',
      parameters: [{ name: 'tail', required: true, source: 'input' }],
      timeoutMs: null,
      updatedAt: expect.any(String),
    });
    const id = created.body.id;

    // the list contains the new skill alongside the seeded lifecycle rows.
    await request(server())
      .get('/skills')
      .expect(200)
      .expect((res) => expect(res.body.some((s: { id: string }) => s.id === id)).toBe(true));
    await request(server())
      .get(`/skills/${id}`)
      .expect(200)
      .expect((res) => expect(res.body.name).toBe('logs'));

    const updated = await request(server()).patch(`/skills/${id}`).send({ name: 'logs-renamed' }).expect(200);
    expect(updated.body.name).toBe('logs-renamed');

    await request(server()).delete(`/skills/${id}`).expect(204);
    await request(server()).get(`/skills/${id}`).expect(404);
  });

  it('rejects a duplicate name in the same scope with a 409 conflict', async () => {
    await request(server()).post('/skills').send(globalSkill).expect(201);

    const res = await request(server()).post('/skills').send(globalSkill).expect(409);
    expect(res.body).toEqual({
      message: expect.any(String),
      status: 409,
      timestamp: expect.any(String),
    });
  });

  it('shapes a validation error into the apiError envelope', async () => {
    // an undeclared placeholder fails the parity refine at the boundary.
    const res = await request(server())
      .post('/skills')
      .send({ commandTemplate: 'docker logs {{nope}}', name: 'bad', parameters: [] })
      .expect(400);
    expect(res.body).toEqual({
      message: expect.any(String),
      status: 400,
      timestamp: expect.any(String),
    });
  });

  it('returns 404 for an unknown id', async () => {
    await request(server()).get('/skills/skill_missing').expect(404);
  });
});
