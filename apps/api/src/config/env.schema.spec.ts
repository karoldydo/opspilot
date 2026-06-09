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
