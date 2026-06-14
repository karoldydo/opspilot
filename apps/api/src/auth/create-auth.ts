import { DatabaseConnection } from '@api/database/providers/database-connection.provider';
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

// single place the better-auth instance is configured. shared by the nest
// provider (runtime, on the injected connection) and the cli config used to
// generate the drizzle tables — so table generation can never drift from
// runtime behaviour.
export function createAuth(options: CreateAuthOptions) {
  return betterAuth({
    // basePath '/auth' + the global '/api' prefix => effective '/api/auth',
    // which is exactly what createAuthClient({ baseURL: '/api' }) expects.
    basePath: '/auth',
    baseURL: options.url,
    database: drizzleAdapter(options.db, { provider: 'sqlite' }),
    emailAndPassword: {
      // cloudflare access (allowed-emails policy + warp) fronts the entire app
      // and is the registration gate; open in-app signup is safe only under
      // that gate. emailAndPassword.disableSignUp: true is the one-line lever
      // if that assumption ever changes (see change.md deployment assumption).
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
