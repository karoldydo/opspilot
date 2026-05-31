import { defineConfig } from 'drizzle-kit';

// drizzle-kit config for sqlite — generate/migrate target the same schema the
// runtime loads and emit into ./migrations (packaged into the image in phase 3).
// url mirrors the runtime default/env so generate runs against the same file.
const databasePath =
  process.env.DATABASE_PATH ?? (process.env.NODE_ENV === 'production' ? '/data/opspilot.db' : './data/opspilot.db');

export default defineConfig({
  dbCredentials: {
    url: databasePath,
  },
  dialect: 'sqlite',
  out: './migrations',
  schema: './src/database/schema/index.ts',
});
