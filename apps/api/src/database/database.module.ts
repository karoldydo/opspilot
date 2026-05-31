import { Global, Module } from '@nestjs/common';

import { DATABASE, databaseFilePreexistedProvider, databaseProvider } from './database.providers';
import { MigrationService } from './migration.service';

// @Global so every later feature module injects the same app-scoped connection.
// MigrationService runs migrate() on bootstrap behind the backup gate.
@Global()
@Module({
  exports: [DATABASE],
  providers: [databaseFilePreexistedProvider, databaseProvider, MigrationService],
})
export class DatabaseModule {}
