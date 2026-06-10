import { envSchema } from './env.schema';

describe('envSchema — ENCRYPTION_KEY', () => {
  // the required env that must be present for validation to reach ENCRYPTION_KEY.
  const baseEnv = {
    BETTER_AUTH_SECRET: 'a'.repeat(32),
    BETTER_AUTH_URL: 'http://localhost:3000',
    TRUSTED_ORIGINS: 'http://localhost:4200',
  };
  // a valid 32-byte master key as base64 (44 chars).
  const validKey = 'lhGl9GfCflVu1P9xxdKvdhcwQGYO/Yf/zxBN1jUfizk=';
  // mirror config.module.ts boot-time validation options.
  const options = { abortEarly: false, allowUnknown: true };

  it('rejects a missing ENCRYPTION_KEY (fails fast at boot)', () => {
    const actual = envSchema.validate(baseEnv, options);

    expect(actual.error).toBeDefined();
    expect(actual.error?.message).toContain('ENCRYPTION_KEY');
  });

  it('rejects a wrong-length ENCRYPTION_KEY', () => {
    const actual = envSchema.validate({ ...baseEnv, ENCRYPTION_KEY: 'dG9vLXNob3J0' }, options);

    expect(actual.error).toBeDefined();
    expect(actual.error?.message).toContain('ENCRYPTION_KEY');
  });

  it('accepts a valid 44-char base64 ENCRYPTION_KEY', () => {
    const actual = envSchema.validate({ ...baseEnv, ENCRYPTION_KEY: validKey }, options);

    expect(actual.error).toBeUndefined();
    expect(actual.value.ENCRYPTION_KEY).toBe(validKey);
  });
});

describe('envSchema — SSH timeouts', () => {
  // the required env (incl. a valid key) so validation reaches the ssh tunables.
  const baseEnv = {
    BETTER_AUTH_SECRET: 'a'.repeat(32),
    BETTER_AUTH_URL: 'http://localhost:3000',
    ENCRYPTION_KEY: 'lhGl9GfCflVu1P9xxdKvdhcwQGYO/Yf/zxBN1jUfizk=',
    TRUSTED_ORIGINS: 'http://localhost:4200',
  };
  const options = { abortEarly: false, allowUnknown: true };

  it('rejects a below-minimum SSH_CONNECT_TIMEOUT_MS (fails fast at boot)', () => {
    const actual = envSchema.validate({ ...baseEnv, SSH_CONNECT_TIMEOUT_MS: '10' }, options);

    expect(actual.error).toBeDefined();
    expect(actual.error?.message).toContain('SSH_CONNECT_TIMEOUT_MS');
  });

  it('rejects a non-numeric SSH_COMMAND_TIMEOUT_MS', () => {
    const actual = envSchema.validate({ ...baseEnv, SSH_COMMAND_TIMEOUT_MS: 'abc' }, options);

    expect(actual.error).toBeDefined();
    expect(actual.error?.message).toContain('SSH_COMMAND_TIMEOUT_MS');
  });

  it('defaults both SSH timeouts when omitted', () => {
    const actual = envSchema.validate(baseEnv, options);

    expect(actual.error).toBeUndefined();
    expect(actual.value.SSH_CONNECT_TIMEOUT_MS).toBe(10000);
    expect(actual.value.SSH_COMMAND_TIMEOUT_MS).toBe(30000);
  });
});
