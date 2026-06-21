import { DatabaseConnection } from '@api/core/database/providers/database-connection.provider';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';

export interface CreateAuthOptions {
  db: DatabaseConnection;
  secret: string;
  sessionExpiresIn: number;
  sessionUpdateAge: number;
  trustedOrigins: string[];
  url: string;
}

// single better-auth config, shared by the nest provider (runtime) and the cli
// table-generation config — so generated tables never drift from runtime.
export function createAuth(options: CreateAuthOptions) {
  return betterAuth({
    // basePath '/auth' + the global '/api' prefix => effective '/api/auth',
    // which is exactly what createAuthClient({ baseURL: '/api' }) expects.
    basePath: '/auth',
    baseURL: options.url,
    database: drizzleAdapter(options.db, { provider: 'sqlite' }),
    emailAndPassword: {
      // open signup is safe only because cloudflare access (allowed-emails + warp)
      // fronts the app as the registration gate; flip disableSignUp: true if that
      // assumption changes (see change.md deployment assumption).
      enabled: true,
    },
    secret: options.secret,
    session: {
      expiresIn: options.sessionExpiresIn,
      updateAge: options.sessionUpdateAge,
    },
    // origins better-auth trusts — supplied via the TRUSTED_ORIGINS env var so
    // the public https url(s) are config, not an in-file constant.
    trustedOrigins: options.trustedOrigins,
  });
}
