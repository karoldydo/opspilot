import { ConfigModule } from '@api/config/config.module';
import { databaseConfig } from '@api/config/database.config';
import { DatabaseModule } from '@api/core/database/database.module';
import { DATABASE_CONNECTION, DatabaseConnection } from '@api/core/database/providers/database-connection.provider';
import { HttpStatus } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { healthResponseSchema } from '@opspilot/shared';
import { Response } from 'express';
import { existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { HealthController } from './health.controller';
import { HealthModule } from './health.module';

// integration: prove /api/health returns a schema-valid body with db: 'up'
// against a live temp db — the end-to-end shared → api → db wiring assertion.
describe('HealthController', () => {
  let testingModule: TestingModule;
  let healthController: HealthController;
  let databaseConnection: DatabaseConnection;
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
    testingModule = await Test.createTestingModule({
      imports: [ConfigModule, DatabaseModule, HealthModule],
    })
      .overrideProvider(databaseConfig.KEY)
      .useValue({ path: dbPath })
      .compile();
    healthController = testingModule.get(HealthController);
    databaseConnection = testingModule.get<DatabaseConnection>(DATABASE_CONNECTION);
  });

  afterEach(async () => {
    if (databaseConnection.$client.open) {
      databaseConnection.$client.close();
    }
    await testingModule.close();
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

    const result = healthController.check(res);

    expect(healthResponseSchema.parse(result)).toEqual(result);
    expect(result.status).toBe('ok');
    expect(result.db).toBe('up');
    expect(captured.statusCode).toBe(HttpStatus.OK);
  });

  it('reports db down with 503 when the connection fails', () => {
    // simulate a failed SELECT 1 on a live connection by closing the handle —
    // exercises the caught-error branch (manual 4.6) without an unwritable path.
    databaseConnection.$client.close();
    const { captured, res } = mockResponse();

    const result = healthController.check(res);

    expect(healthResponseSchema.parse(result)).toEqual(result);
    expect(result.status).toBe('error');
    expect(result.db).toBe('down');
    expect(captured.statusCode).toBe(HttpStatus.SERVICE_UNAVAILABLE);
  });
});
