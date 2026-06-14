import { DATABASE_CONNECTION, DatabaseConnection } from '@api/core/database/providers/database-connection.provider';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { HealthResponse } from '@opspilot/shared';

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
