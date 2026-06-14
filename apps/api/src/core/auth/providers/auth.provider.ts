import { authConfig, AuthConfig } from '@api/config/auth.config';
import { createAuth } from '@api/core/auth/create-auth';
import { DATABASE_CONNECTION, DatabaseConnection } from '@api/core/database/providers/database-connection.provider';
import { Provider } from '@nestjs/common';

export const AUTH_INSTANCE = 'AUTH_INSTANCE';

export type AuthInstance = ReturnType<typeof createAuth>;

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
