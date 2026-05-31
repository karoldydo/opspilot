import * as Joi from 'joi';

export interface EnvConfig {
  DATABASE_BACKUP_RETENTION: number;
  DATABASE_PATH: string;
  NODE_ENV: 'development' | 'production' | 'test';
  PORT: number;
}

export const envSchema = Joi.object<EnvConfig>({
  DATABASE_BACKUP_RETENTION: Joi.number().integer().min(1).default(5),
  DATABASE_PATH: Joi.string().min(1).default('./data/opspilot.db'),
  NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
  PORT: Joi.number().port().default(3000),
});
