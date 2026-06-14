import { createAuth } from '@api/auth/create-auth';
import { authConfig, AuthConfig } from '@api/config/auth.config';
import { DATABASE_CONNECTION, DatabaseConnection } from '@api/database/providers/database-connection.provider';
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
