import { Inject, Injectable, Logger } from '@nestjs/common';
import { HealthResponse } from '@opspilot/shared';

import { DATABASE_CONNECTION, DatabaseConnection } from '../database/providers/database-connection.provider';

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(@Inject(DATABASE_CONNECTION) private readonly databaseConnection: DatabaseConnection) {}

  check(): HealthResponse {
    try {
      this.databaseConnection.$client.prepare('SELECT 1').get();
      return { db: 'up', status: 'ok', timestamp: new Date().toISOString() };
    } catch (error) {
      this.logger.error('db ping failed', error instanceof Error ? error.stack : String(error));
      return { db: 'down', status: 'error', timestamp: new Date().toISOString() };
    }
  }
}
