import { Global, Module } from '@nestjs/common';

import { DatabaseService } from './database.service';
import { MigrationService } from './migration/migration.service';
import { DATABASE_CONNECTION, databaseConnectionProvider } from './providers/database-connection.provider';
import { databaseExistedProvider } from './providers/database-existed.provider';
import { migrationsFolderProvider } from './providers/migrations-folder.provider';

@Global()
@Module({
  exports: [DATABASE_CONNECTION],
  providers: [
    databaseExistedProvider,
    databaseConnectionProvider,
    migrationsFolderProvider,
    MigrationService,
    DatabaseService,
  ],
})
export class DatabaseModule {}
