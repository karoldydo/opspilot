import { Inject, Injectable, Logger } from '@nestjs/common';
import { HealthResponse } from '@opspilot/shared';

import { DATABASE, DatabaseConnection } from '../database/database.providers';

// keeps the db-readiness logic in a service (thin controller rule, nestjs.md):
// run SELECT 1 against the injected connection and build the shared contract.
@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  // explicit token: vitest transforms with esbuild (no emitDecoratorMetadata),
  // so type-based DI would resolve to undefined — inject the class token directly.
  constructor(@Inject(DATABASE) private readonly db: DatabaseConnection) {}

  check(): HealthResponse {
    // better-sqlite3 is synchronous — no await on the driver (drizzle.md).
    try {
      this.db.$client.prepare('SELECT 1').get();
      return { db: 'up', status: 'ok', timestamp: new Date().toISOString() };
    } catch (error) {
      this.logger.error('db ping failed', error instanceof Error ? error.stack : String(error));
      return { db: 'down', status: 'error', timestamp: new Date().toISOString() };
    }
  }
}
