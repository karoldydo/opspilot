import * as Joi from 'joi';

export interface EnvConfig {
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  DATABASE_BACKUP_RETENTION: number;
  DATABASE_PATH: string;
  DEVICE_CREDENTIAL_LIST_LIMIT: number;
  ENCRYPTION_KEY: string;
  LLM_DIAGNOSE_LOGS_TAIL: number;
  LLM_DIAGNOSE_LOGS_TIMEOUT_MS: number;
  LLM_GENERATE_TIMEOUT_MS: number;
  LLM_TEST_TIMEOUT_MS: number;
  NODE_ENV: 'development' | 'production' | 'test';
  PORT: number;
  SESSION_EXPIRES_IN: number;
  SESSION_UPDATE_AGE: number;
  SSH_COMMAND_TIMEOUT_MS: number;
  SSH_CONNECT_TIMEOUT_MS: number;
  TRUSTED_ORIGINS: string;
}

export const envSchema = Joi.object<EnvConfig>({
  // no default — a missing/short secret must fail fast at boot.
  BETTER_AUTH_SECRET: Joi.string().min(32).required(),
  // explicit https public url the app is served from (behind cloudflare).
  BETTER_AUTH_URL: Joi.string().uri().required(),
  DATABASE_BACKUP_RETENTION: Joi.number().integer().min(1).default(5),
  DATABASE_PATH: Joi.string().min(1).default('./data/opspilot.db'),
  // default page size for the credential-list endpoint; the hard ceiling (<=100)
  // is enforced separately by credentialListQuerySchema at the request boundary.
  DEVICE_CREDENTIAL_LIST_LIMIT: Joi.number().integer().min(1).max(100).default(50),
  // no default — master aes-256 key, 32 raw bytes as base64 (44 chars). must fail fast at boot.
  ENCRYPTION_KEY: Joi.string().base64().length(44).required(),
  // how many trailing log lines the s-04 diagnose fetch reads (docker logs --tail) and feeds the synthesis.
  LLM_DIAGNOSE_LOGS_TAIL: Joi.number().integer().min(1).default(200),
  // tight per-command bound on the s-04 logs fetch — distinct from the 30s default SSH_COMMAND_TIMEOUT_MS.
  LLM_DIAGNOSE_LOGS_TIMEOUT_MS: Joi.number().integer().min(1000).default(5000),
  // bound on the s-04 synthesis generation, passed as generateText's AbortSignal.timeout (keeps the run < 15s).
  LLM_GENERATE_TIMEOUT_MS: Joi.number().integer().min(1000).default(12000),
  // bound on the outbound provider test-call (fetch + AbortSignal.timeout); non-secret tunable with a default.
  LLM_TEST_TIMEOUT_MS: Joi.number().integer().min(1000).default(5000),
  NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
  PORT: Joi.number().port().default(3000),
  // session lifetimes in seconds — better-auth defaults (7 days / 1 day).
  SESSION_EXPIRES_IN: Joi.number().integer().min(60).default(604800),
  SESSION_UPDATE_AGE: Joi.number().integer().min(60).default(86400),
  // per-command timeout for the hand-rolled execCommand race (node-ssh has none).
  SSH_COMMAND_TIMEOUT_MS: Joi.number().integer().min(1000).default(30000),
  // node-ssh readyTimeout bound on the connect/handshake so an unreachable host fails fast.
  SSH_CONNECT_TIMEOUT_MS: Joi.number().integer().min(1000).default(10000),
  // comma-separated list of origins better-auth trusts — required, no default.
  TRUSTED_ORIGINS: Joi.string().min(1).required(),
});
