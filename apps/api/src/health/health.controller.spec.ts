import { HttpStatus } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { healthResponseSchema } from '@opspilot/shared';
import { Response } from 'express';
import { existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ConfigModule } from '../config/config.module';
import { ConfigService } from '../config/config.service';
import { DatabaseModule } from '../database/database.module';
import { DATABASE, DatabaseConnection } from '../database/database.providers';
import { HealthController } from './health.controller';
import { HealthModule } from './health.module';

// integration: prove /api/health returns a schema-valid body with db: 'up'
// against a live temp db — the end-to-end shared → api → db wiring assertion.
describe('HealthController', () => {
  let moduleRef: TestingModule;
  let controller: HealthController;
  let db: DatabaseConnection;
  let dbPath: string;

  // minimal passthrough Response stub capturing the status code the handler sets.
  const mockResponse = (): { captured: { statusCode: number }; res: Response } => {
    const captured = { statusCode: 0 };
    const res = {
      status(code: number) {
        captured.statusCode = code;
        return this;
      },
    } as unknown as Response;
    return { captured, res };
  };

  beforeEach(async () => {
    // temp-db seam: never let the default ./data/opspilot.db be opened in ci.
    dbPath = join(tmpdir(), `opspilot-health-test-${process.pid}-${Date.now()}.db`);
    moduleRef = await Test.createTestingModule({
      imports: [ConfigModule, DatabaseModule, HealthModule],
    })
      .overrideProvider(ConfigService)
      .useValue({ databasePath: dbPath, port: 3000 })
      .compile();
    controller = moduleRef.get(HealthController);
    db = moduleRef.get<DatabaseConnection>(DATABASE);
  });

  afterEach(async () => {
    if (db.$client.open) {
      db.$client.close();
    }
    await moduleRef.close();
    // clean up the temp file + wal/shm sidecars.
    for (const suffix of ['', '-wal', '-shm']) {
      const path = `${dbPath}${suffix}`;
      if (existsSync(path)) {
        rmSync(path);
      }
    }
  });

  it('returns a schema-valid body with db up and 200 against a live db', () => {
    const { captured, res } = mockResponse();

    const result = controller.check(res);

    expect(healthResponseSchema.parse(result)).toEqual(result);
    expect(result.status).toBe('ok');
    expect(result.db).toBe('up');
    expect(captured.statusCode).toBe(HttpStatus.OK);
  });

  it('reports db down with 503 when the connection fails', () => {
    // simulate a failed SELECT 1 on a live connection by closing the handle —
    // exercises the caught-error branch (manual 4.6) without an unwritable path.
    db.$client.close();
    const { captured, res } = mockResponse();

    const result = controller.check(res);

    expect(healthResponseSchema.parse(result)).toEqual(result);
    expect(result.status).toBe('error');
    expect(result.db).toBe('down');
    expect(captured.statusCode).toBe(HttpStatus.SERVICE_UNAVAILABLE);
  });
});
