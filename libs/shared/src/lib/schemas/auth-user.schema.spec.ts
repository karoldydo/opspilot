import { authUserSchema } from './auth-user.schema';

describe('authUserSchema', () => {
  it('parses a valid user with a null image', () => {
    const valid = {
      createdAt: '2026-06-08T12:00:00.000Z',
      email: 'ops@example.com',
      emailVerified: false,
      id: 'usr_123',
      image: null,
      name: 'Ops Pilot',
      updatedAt: '2026-06-08T12:00:00.000Z',
    };

    expect(authUserSchema.parse(valid)).toEqual(valid);
  });

  it('parses a valid user with an image string', () => {
    const valid = {
      createdAt: '2026-06-08T12:00:00.000Z',
      email: 'ops@example.com',
      emailVerified: true,
      id: 'usr_123',
      image: 'https://example.com/avatar.png',
      name: 'Ops Pilot',
      updatedAt: '2026-06-08T12:00:00.000Z',
    };

    expect(authUserSchema.parse(valid)).toEqual(valid);
  });

  it('normalizes a Date timestamp to an iso string', () => {
    const createdAt = new Date('2026-06-08T12:00:00.000Z');
    const updatedAt = new Date('2026-06-09T08:30:00.000Z');

    const parsed = authUserSchema.parse({
      createdAt,
      email: 'ops@example.com',
      emailVerified: false,
      id: 'usr_123',
      image: null,
      name: 'Ops Pilot',
      updatedAt,
    });

    expect(parsed.createdAt).toBe('2026-06-08T12:00:00.000Z');
    expect(parsed.updatedAt).toBe('2026-06-09T08:30:00.000Z');
  });

  it('rejects a non-iso timestamp', () => {
    const result = authUserSchema.safeParse({
      createdAt: 'yesterday',
      email: 'ops@example.com',
      emailVerified: false,
      id: 'usr_123',
      image: null,
      name: 'Ops Pilot',
      updatedAt: '2026-06-08T12:00:00.000Z',
    });

    expect(result.success).toBe(false);
  });

  it('rejects an extra key (strict)', () => {
    const result = authUserSchema.safeParse({
      createdAt: '2026-06-08T12:00:00.000Z',
      email: 'ops@example.com',
      emailVerified: false,
      id: 'usr_123',
      image: null,
      name: 'Ops Pilot',
      role: 'admin',
      updatedAt: '2026-06-08T12:00:00.000Z',
    });

    expect(result.success).toBe(false);
  });
});
