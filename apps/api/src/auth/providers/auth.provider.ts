import { Provider } from '@nestjs/common';

import { authConfig, AuthConfig } from '../../config/auth.config';
import { DATABASE_CONNECTION, DatabaseConnection } from '../../database/providers/database-connection.provider';
import { createAuth } from '../create-auth';

export const AUTH_INSTANCE = 'AUTH_INSTANCE';

export type AuthInstance = ReturnType<typeof createAuth>;

// the singleton better-auth instance, built on the shared db connection and the
// joi-validated auth config. injected by the catch-all controller and the
// global guard.
export const authProvider: Provider = {
  inject: [DATABASE_CONNECTION, authConfig.KEY],
  provide: AUTH_INSTANCE,
  useFactory: (db: DatabaseConnection, config: AuthConfig): AuthInstance =>
    createAuth({
      db,
      secret: config.secret,
      sessionExpiresIn: config.sessionExpiresIn,
      sessionUpdateAge: config.sessionUpdateAge,
      trustedOrigins: config.trustedOrigins,
      url: config.url,
    }),
};
