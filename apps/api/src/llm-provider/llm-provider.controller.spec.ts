import { INestApplication } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import request from 'supertest';

import { AllExceptionsFilter } from '../common/all-exceptions.filter';
import { ConfigModule } from '../config/config.module';
import { cryptoConfig } from '../config/crypto.config';
import { databaseConfig } from '../config/database.config';
import { DatabaseModule } from '../database/database.module';
import { LlmProviderModule } from './llm-provider.module';

// e2e against a live temp db. the global AuthAppGuard is not wired here (only
// AppModule registers it via APP_GUARD), so routes are open — guard behavior is
// covered by auth.guard.spec.ts. these tests assert the routes, the single-active
// invariant over http, the apiError shaping, and that no secret leaks.
describe('LlmProviderController (e2e)', () => {
  // a fixed 32-byte key (0x01 * 32) base64-encoded to 44 chars.
  const inputKey = 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=';
  const baseBody = { baseURL: 'https://api.openai.com/v1', kind: 'openai-compatible', model: 'gpt-4o' };

  let moduleRef: TestingModule;
  let app: INestApplication;
  let dbPath: string;

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
    dbPath = join(tmpdir(), `opspilot-llm-ctrl-test-${process.pid}-${Date.now()}.db`);
    moduleRef = await Test.createTestingModule({
      imports: [ConfigModule, DatabaseModule, LlmProviderModule],
      providers: [{ provide: APP_FILTER, useClass: AllExceptionsFilter }],
    })
      .overrideProvider(databaseConfig.KEY)
      .useValue({ backupRetention: 5, path: dbPath })
      .overrideProvider(cryptoConfig.KEY)
      .useValue({ encryptionKey: inputKey })
      .compile();
    app = moduleRef.createNestApplication();
    // app.init() triggers onApplicationBootstrap, which runs the migrations.
    await app.init();
  });

  afterEach(async () => {
    await app?.close();
    cleanupTempFiles();
  });

  const server = () => app.getHttpServer();

  it('creates, lists, fetches, updates and deletes a provider without leaking the key', async () => {
    const inputApiKey = 'sk-secret-key';
    const created = await request(server())
      .post('/llm-providers')
      .send({ ...baseBody, apiKey: inputApiKey })
      .expect(201);
    expect(created.body).toEqual({
      active: true,
      baseURL: baseBody.baseURL,
      createdAt: expect.any(String),
      hasApiKey: true,
      id: expect.any(String),
      kind: 'openai-compatible',
      model: 'gpt-4o',
      updatedAt: expect.any(String),
    });
    // no secret material crosses the boundary on create.
    expect(JSON.stringify(created.body)).not.toContain(inputApiKey);
    expect(created.body).not.toHaveProperty('apiKey');
    expect(created.body).not.toHaveProperty('ciphertext');
    const id = created.body.id;

    await request(server())
      .get('/llm-providers')
      .expect(200)
      .expect((res) => expect(res.body).toHaveLength(1));
    await request(server())
      .get(`/llm-providers/${id}`)
      .expect(200)
      .expect((res) => expect(res.body.model).toBe('gpt-4o'));

    const updated = await request(server()).patch(`/llm-providers/${id}`).send({ model: 'gpt-4o-mini' }).expect(200);
    expect(updated.body.model).toBe('gpt-4o-mini');

    await request(server()).delete(`/llm-providers/${id}`).expect(204);
    await request(server()).get(`/llm-providers/${id}`).expect(404);
  });

  it('enforces the single-active invariant over create + activate + delete', async () => {
    const first = await request(server())
      .post('/llm-providers')
      .send({ ...baseBody, apiKey: 'sk-1' })
      .expect(201);
    const second = await request(server())
      .post('/llm-providers')
      .send({ ...baseBody, apiKey: 'sk-2', model: 'gpt-4o-mini' })
      .expect(201);

    // first created is auto-active, second is not.
    expect(first.body.active).toBe(true);
    expect(second.body.active).toBe(false);

    // activate the second → exactly one active, the first loses it.
    await request(server()).patch(`/llm-providers/${second.body.id}/activate`).expect(200);
    const afterActivate = await request(server()).get('/llm-providers').expect(200);
    expect(afterActivate.body.filter((p: { active: boolean }) => p.active)).toHaveLength(1);
    expect(afterActivate.body.find((p: { id: string }) => p.id === second.body.id).active).toBe(true);

    // delete the active one → zero active, no error.
    await request(server()).delete(`/llm-providers/${second.body.id}`).expect(204);
    const afterDelete = await request(server()).get('/llm-providers').expect(200);
    expect(afterDelete.body).toHaveLength(1);
    expect(afterDelete.body.filter((p: { active: boolean }) => p.active)).toHaveLength(0);
  });

  it('shapes a validation error into the apiError envelope', async () => {
    const res = await request(server())
      .post('/llm-providers')
      .send({ apiKey: '', baseURL: 'not-a-url', model: '' })
      .expect(400);
    expect(res.body).toEqual({
      message: expect.any(String),
      status: 400,
      timestamp: expect.any(String),
    });
  });
});
