import { Inject, Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';

import { DATABASE_CONNECTION, DatabaseConnection } from './providers/database-connection.provider';

@Injectable()
export class DatabaseService implements OnApplicationShutdown {
  private readonly logger = new Logger(DatabaseService.name);

  constructor(@Inject(DATABASE_CONNECTION) private readonly databaseConnection: DatabaseConnection) {}

  onApplicationShutdown(signal?: string): void {
    // already-closed is safe to call twice; guard only to skip the log noise.
    if (!this.databaseConnection.$client.open) {
      return;
    }
    this.databaseConnection.$client.close();
    this.logger.log(`db connection closed on ${signal ?? 'shutdown'}`);
  }
}
