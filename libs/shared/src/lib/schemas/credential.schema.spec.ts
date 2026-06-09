import { credentialSchema } from './credential.schema';

describe('credentialSchema', () => {
  it('parses a valid credential', () => {
    const valid = {
      authType: 'password',
      createdAt: '2026-06-08T12:00:00.000Z',
      deviceId: 'dev_123',
      id: 'cred_123',
      updatedAt: '2026-06-08T12:00:00.000Z',
      username: 'ops',
    };

    expect(credentialSchema.parse(valid)).toEqual(valid);
  });

  it('normalizes a Date timestamp to an iso string', () => {
    const createdAt = new Date('2026-06-08T12:00:00.000Z');
    const updatedAt = new Date('2026-06-09T08:30:00.000Z');

    const parsed = credentialSchema.parse({
      authType: 'key',
      createdAt,
      deviceId: 'dev_123',
      id: 'cred_123',
      updatedAt,
      username: 'ops',
    });

    expect(parsed.createdAt).toBe('2026-06-08T12:00:00.000Z');
    expect(parsed.updatedAt).toBe('2026-06-09T08:30:00.000Z');
  });

  it('rejects an unknown authType', () => {
    const result = credentialSchema.safeParse({
      authType: 'token',
      createdAt: '2026-06-08T12:00:00.000Z',
      deviceId: 'dev_123',
      id: 'cred_123',
      updatedAt: '2026-06-08T12:00:00.000Z',
      username: 'ops',
    });

    expect(result.success).toBe(false);
  });

  it('rejects a leaked ciphertext field (strict)', () => {
    const result = credentialSchema.safeParse({
      authType: 'password',
      ciphertext: 'AQID',
      createdAt: '2026-06-08T12:00:00.000Z',
      deviceId: 'dev_123',
      id: 'cred_123',
      updatedAt: '2026-06-08T12:00:00.000Z',
      username: 'ops',
    });

    expect(result.success).toBe(false);
  });

  it('rejects a leaked secret field (strict)', () => {
    const result = credentialSchema.safeParse({
      authType: 'password',
      createdAt: '2026-06-08T12:00:00.000Z',
      deviceId: 'dev_123',
      id: 'cred_123',
      secret: 'super-secret',
      updatedAt: '2026-06-08T12:00:00.000Z',
      username: 'ops',
    });

    expect(result.success).toBe(false);
  });
});
