import { authRegisterRequestSchema } from './auth-register-request.schema';

describe('authRegisterRequestSchema', () => {
  it('parses a valid register request', () => {
    const valid = {
      email: 'ops@example.com',
      name: 'Ops Pilot',
      password: 'correct horse battery',
    };

    expect(authRegisterRequestSchema.parse(valid)).toEqual(valid);
  });

  it('rejects an invalid email', () => {
    const result = authRegisterRequestSchema.safeParse({
      email: 'not-an-email',
      name: 'Ops Pilot',
      password: 'correct horse battery',
    });

    expect(result.success).toBe(false);
  });

  it('rejects a too-short password', () => {
    const result = authRegisterRequestSchema.safeParse({
      email: 'ops@example.com',
      name: 'Ops Pilot',
      password: 'short',
    });

    expect(result.success).toBe(false);
  });

  it('rejects a missing name', () => {
    const result = authRegisterRequestSchema.safeParse({
      email: 'ops@example.com',
      name: '',
      password: 'correct horse battery',
    });

    expect(result.success).toBe(false);
  });

  it('rejects an extra key (strict)', () => {
    const result = authRegisterRequestSchema.safeParse({
      confirmPassword: 'correct horse battery',
      email: 'ops@example.com',
      name: 'Ops Pilot',
      password: 'correct horse battery',
    });

    expect(result.success).toBe(false);
  });
});
