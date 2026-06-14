import { databaseConfig, DatabaseConfig } from '@api/config/database.config';
import { Provider } from '@nestjs/common';
import { existsSync } from 'node:fs';

export const DATABASE_EXISTED = 'DATABASE_EXISTED';

// did the db file exist before the connection provider opened (created) it?
// that provider depends on this token, so nest resolves it first.
export const databaseExistedProvider: Provider = {
  inject: [databaseConfig.KEY],
  provide: DATABASE_EXISTED,
  useFactory: (config: DatabaseConfig): boolean => existsSync(config.path),
};
