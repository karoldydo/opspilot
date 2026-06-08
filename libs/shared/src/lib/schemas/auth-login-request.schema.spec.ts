import { authLoginRequestSchema } from './auth-login-request.schema';

describe('authLoginRequestSchema', () => {
  it('parses a valid login request', () => {
    const valid = {
      email: 'ops@example.com',
      password: 'correct horse battery',
    };

    expect(authLoginRequestSchema.parse(valid)).toEqual(valid);
  });

  it('rejects an invalid email', () => {
    const result = authLoginRequestSchema.safeParse({
      email: 'not-an-email',
      password: 'correct horse battery',
    });

    expect(result.success).toBe(false);
  });

  it('rejects a too-short password', () => {
    const result = authLoginRequestSchema.safeParse({
      email: 'ops@example.com',
      password: 'short',
    });

    expect(result.success).toBe(false);
  });

  it('rejects an extra key (strict)', () => {
    const result = authLoginRequestSchema.safeParse({
      email: 'ops@example.com',
      name: 'unexpected',
      password: 'correct horse battery',
    });

    expect(result.success).toBe(false);
  });
});
