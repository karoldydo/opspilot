import * as Joi from 'joi';

export interface EnvConfig {
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  DATABASE_BACKUP_RETENTION: number;
  DATABASE_PATH: string;
  ENCRYPTION_KEY: string;
  NODE_ENV: 'development' | 'production' | 'test';
  PORT: number;
  SESSION_EXPIRES_IN: number;
  SESSION_UPDATE_AGE: number;
  TRUSTED_ORIGINS: string;
}

export const envSchema = Joi.object<EnvConfig>({
  // no default — a missing/short secret must fail fast at boot.
  BETTER_AUTH_SECRET: Joi.string().min(32).required(),
  // explicit https public url the app is served from (behind cloudflare).
  BETTER_AUTH_URL: Joi.string().uri().required(),
  DATABASE_BACKUP_RETENTION: Joi.number().integer().min(1).default(5),
  DATABASE_PATH: Joi.string().min(1).default('./data/opspilot.db'),
  // no default — master aes-256 key, 32 raw bytes as base64 (44 chars). must fail fast at boot.
  ENCRYPTION_KEY: Joi.string().base64().length(44).required(),
  NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
  PORT: Joi.number().port().default(3000),
  // session lifetimes in seconds — better-auth defaults (7 days / 1 day).
  SESSION_EXPIRES_IN: Joi.number().integer().min(60).default(604800),
  SESSION_UPDATE_AGE: Joi.number().integer().min(60).default(86400),
  // comma-separated list of origins better-auth trusts — required, no default.
  TRUSTED_ORIGINS: Joi.string().min(1).required(),
});
