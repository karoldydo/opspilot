import { Global, Module } from '@nestjs/common';

import { DATABASE, databaseProvider } from './database.providers';

// @Global so every later feature module injects the same app-scoped connection.
@Global()
@Module({
  exports: [DATABASE],
  providers: [databaseProvider],
})
export class DatabaseModule {}
