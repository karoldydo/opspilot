import { ConfigType, registerAs } from '@nestjs/config';

export const authConfig = registerAs('auth', () => ({
  secret: process.env.BETTER_AUTH_SECRET as string,
  sessionExpiresIn: Number(process.env.SESSION_EXPIRES_IN),
  sessionUpdateAge: Number(process.env.SESSION_UPDATE_AGE),
  trustedOrigins: (process.env.TRUSTED_ORIGINS as string)
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
  url: process.env.BETTER_AUTH_URL as string,
}));

export type AuthConfig = ConfigType<typeof authConfig>;
