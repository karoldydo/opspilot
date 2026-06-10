import { serviceSchema } from './service.schema';

describe('serviceSchema', () => {
  const valid = {
    composePath: null,
    composeProject: null,
    containerName: 'nginx',
    createdAt: '2026-06-08T12:00:00.000Z',
    deviceId: '22222222-2222-4222-8222-222222222222',
    id: '11111111-1111-4111-8111-111111111111',
    name: 'web proxy',
    updatedAt: '2026-06-08T12:00:00.000Z',
  };

  it('parses a valid service', () => {
    expect(serviceSchema.parse(valid)).toEqual(valid);
  });

  it('parses compose project/path when present', () => {
    const withCompose = { ...valid, composePath: '/opt/stack/compose.yml', composeProject: 'stack' };
    expect(serviceSchema.parse(withCompose)).toEqual(withCompose);
  });

  it('normalizes a Date timestamp to an iso string', () => {
    const parsed = serviceSchema.parse({
      ...valid,
      createdAt: new Date('2026-06-08T12:00:00.000Z'),
      updatedAt: new Date('2026-06-09T08:30:00.000Z'),
    });

    expect(parsed.createdAt).toBe('2026-06-08T12:00:00.000Z');
    expect(parsed.updatedAt).toBe('2026-06-09T08:30:00.000Z');
  });

  it('rejects a non-uuid id', () => {
    expect(serviceSchema.safeParse({ ...valid, id: 'not-a-uuid' }).success).toBe(false);
  });

  it('rejects an unknown key (strict)', () => {
    expect(serviceSchema.safeParse({ ...valid, image: 'nginx:latest' }).success).toBe(false);
  });
});
