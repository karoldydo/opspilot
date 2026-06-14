import { Provider } from '@nestjs/common';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export const MIGRATIONS_FOLDER = 'MIGRATIONS_FOLDER';

// finds the migrations folder across runtime layouts (bundle dir, then cwd).
// first existing wins.
export const migrationsFolderProvider: Provider = {
  provide: MIGRATIONS_FOLDER,
  useFactory: (): string => {
    const candidates = [
      join(__dirname, 'migrations'),
      join(process.cwd(), 'migrations'),
      join(process.cwd(), 'apps', 'api', 'migrations'),
    ];
    return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0];
  },
};
