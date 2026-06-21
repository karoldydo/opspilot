import * as Joi from 'joi';

export interface EnvConfig {
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  DATABASE_BACKUP_RETENTION: number;
  DATABASE_PATH: string;
  DEVICE_CREDENTIAL_LIST_LIMIT: number;
  ENCRYPTION_KEY: string;
  LLM_DIAGNOSE_HISTORY_RETENTION: number;
  LLM_DIAGNOSE_LOGS_TAIL: number;
  LLM_DIAGNOSE_LOGS_TIMEOUT_MS: number;
  LLM_GENERATE_TIMEOUT_MS: number;
  LLM_TEST_TIMEOUT_MS: number;
  NODE_ENV: 'development' | 'production' | 'test';
  PORT: number;
  SESSION_EXPIRES_IN: number;
  SESSION_UPDATE_AGE: number;
  SKILL_TIMEOUT_MS: number;
  SSH_COMMAND_TIMEOUT_MS: number;
  SSH_CONNECT_TIMEOUT_MS: number;
  TRUSTED_ORIGINS: string;
}

export const envSchema = Joi.object<EnvConfig>({
  // no default — a missing/short secret must fail fast at boot.
  BETTER_AUTH_SECRET: Joi.string().min(32).required(),
  BETTER_AUTH_URL: Joi.string().uri().required(),
  DATABASE_BACKUP_RETENTION: Joi.number().integer().min(1).default(5),
  DATABASE_PATH: Joi.string().min(1).default('./data/opspilot.db'),
  // default page size; hard ceiling (<=100) enforced separately by credentialListQuerySchema.
  DEVICE_CREDENTIAL_LIST_LIMIT: Joi.number().integer().min(1).max(100).default(50),
  // no default — master aes-256 key, 32 bytes base64 (44 chars); fails fast at boot.
  ENCRYPTION_KEY: Joi.string().base64().length(44).required(),
  LLM_DIAGNOSE_HISTORY_RETENTION: Joi.number().integer().min(1).default(20),
  LLM_DIAGNOSE_LOGS_TAIL: Joi.number().integer().min(1).default(200),
  // per-command bound on the logs fetch — distinct from SSH_COMMAND_TIMEOUT_MS.
  LLM_DIAGNOSE_LOGS_TIMEOUT_MS: Joi.number().integer().min(1000).default(5000),
  // synthesis generation bound (generateText AbortSignal.timeout); keeps the run < 15s.
  LLM_GENERATE_TIMEOUT_MS: Joi.number().integer().min(1000).default(12000),
  LLM_TEST_TIMEOUT_MS: Joi.number().integer().min(1000).default(5000),
  NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
  PORT: Joi.number().port().default(3000),
  // session lifetimes in seconds — better-auth defaults (7 days / 1 day).
  SESSION_EXPIRES_IN: Joi.number().integer().min(60).default(604800),
  SESSION_UPDATE_AGE: Joi.number().integer().min(60).default(86400),
  // long bound for a synchronous skill run; overrides SSH_COMMAND_TIMEOUT_MS (skill row's own timeoutMs wins).
  SKILL_TIMEOUT_MS: Joi.number().integer().min(1000).default(300000),
  // per-command timeout for the hand-rolled execCommand race (node-ssh has none).
  SSH_COMMAND_TIMEOUT_MS: Joi.number().integer().min(1000).default(30000),
  SSH_CONNECT_TIMEOUT_MS: Joi.number().integer().min(1000).default(10000),
  TRUSTED_ORIGINS: Joi.string().min(1).required(),
});
