import { createAuth } from './src/auth/create-auth';
import { DatabaseConnection } from './src/database/providers/database-connection.provider';

// cli-only better-auth instance consumed by `@better-auth/cli generate` to emit
// the drizzle tables into src/database/schema. it never runs at runtime — the
// nest provider owns the real instance (see src/auth/providers/auth.provider.ts).
// every value below is an unused placeholder: generate derives the tables purely
// from emailAndPassword + the sqlite provider, never from the db, secret, url,
// session lifetimes or trusted origins (those are runtime-only config).
export const auth = createAuth({
  db: {} as unknown as DatabaseConnection,
  secret: 'unused-placeholder-secret-not-used-at-runtime',
  sessionExpiresIn: 0,
  sessionUpdateAge: 0,
  trustedOrigins: ['http://placeholder.invalid'],
  url: 'http://placeholder.invalid',
});
