import { Injectable } from '@nestjs/common';

// centralizes env access so no other service reads process.env directly.
// values are resolved once at construction and exposed via typed getters.
@Injectable()
export class ConfigService {
  private readonly databasePathValue: string;
  private readonly portValue: number;

  constructor() {
    // in the container /data is bind-mounted; in dev fall back to a repo-local file.
    const defaultDatabasePath = process.env.NODE_ENV === 'production' ? '/data/opspilot.db' : './data/opspilot.db';
    this.databasePathValue = process.env.DATABASE_PATH ?? defaultDatabasePath;
    this.portValue = Number(process.env.PORT ?? 3000);
  }

  get databasePath(): string {
    return this.databasePathValue;
  }

  get port(): number {
    return this.portValue;
  }
}
