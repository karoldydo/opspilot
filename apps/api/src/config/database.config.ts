import { ConfigType, registerAs } from '@nestjs/config';

export const databaseConfig = registerAs('database', () => ({
  backupRetention: Number(process.env.DATABASE_BACKUP_RETENTION),
  path: process.env.DATABASE_PATH as string,
}));

export type DatabaseConfig = ConfigType<typeof databaseConfig>;
