import { deviceSchema } from './device.schema';

describe('deviceSchema', () => {
  it('parses a valid device', () => {
    const valid = {
      createdAt: '2026-06-08T12:00:00.000Z',
      host: '192.168.1.10',
      id: '11111111-1111-4111-8111-111111111111',
      name: 'nas',
      updatedAt: '2026-06-08T12:00:00.000Z',
    };

    expect(deviceSchema.parse(valid)).toEqual(valid);
  });

  it('normalizes a Date timestamp to an iso string', () => {
    const createdAt = new Date('2026-06-08T12:00:00.000Z');
    const updatedAt = new Date('2026-06-09T08:30:00.000Z');

    const parsed = deviceSchema.parse({
      createdAt,
      host: '192.168.1.10',
      id: '11111111-1111-4111-8111-111111111111',
      name: 'nas',
      updatedAt,
    });

    expect(parsed.createdAt).toBe('2026-06-08T12:00:00.000Z');
    expect(parsed.updatedAt).toBe('2026-06-09T08:30:00.000Z');
  });

  it('rejects a non-uuid id', () => {
    const result = deviceSchema.safeParse({
      createdAt: '2026-06-08T12:00:00.000Z',
      host: '192.168.1.10',
      id: 'not-a-uuid',
      name: 'nas',
      updatedAt: '2026-06-08T12:00:00.000Z',
    });

    expect(result.success).toBe(false);
  });

  it('rejects an unknown key (strict)', () => {
    const result = deviceSchema.safeParse({
      createdAt: '2026-06-08T12:00:00.000Z',
      host: '192.168.1.10',
      id: '11111111-1111-4111-8111-111111111111',
      name: 'nas',
      secret: 'super-secret',
      updatedAt: '2026-06-08T12:00:00.000Z',
    });

    expect(result.success).toBe(false);
  });
});
