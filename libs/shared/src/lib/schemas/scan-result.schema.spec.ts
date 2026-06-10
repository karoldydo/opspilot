import { scannedContainerSchema, scanResultSchema } from './scan-result.schema';

describe('scannedContainerSchema', () => {
  const valid = {
    composePath: null,
    composeProject: null,
    containerName: 'nginx',
    image: 'nginx:latest',
    state: 'running',
    status: 'Up 3 hours',
  };

  it('parses a standalone container (no compose)', () => {
    expect(scannedContainerSchema.parse(valid)).toEqual(valid);
  });

  it('parses a compose-managed container', () => {
    const composed = { ...valid, composePath: '/opt/stack/compose.yml', composeProject: 'stack' };
    expect(scannedContainerSchema.parse(composed)).toEqual(composed);
  });

  it('rejects an unknown key (strict)', () => {
    expect(scannedContainerSchema.safeParse({ ...valid, ports: '80/tcp' }).success).toBe(false);
  });
});

describe('scanResultSchema', () => {
  it('parses an empty container list', () => {
    expect(scanResultSchema.parse({ containers: [] })).toEqual({ containers: [] });
  });

  it('parses a list of detected containers', () => {
    const result = {
      containers: [
        {
          composePath: null,
          composeProject: null,
          containerName: 'nginx',
          image: 'nginx:latest',
          state: 'running',
          status: 'Up 3 hours',
        },
      ],
    };

    expect(scanResultSchema.parse(result)).toEqual(result);
  });

  it('rejects an unknown key (strict)', () => {
    expect(scanResultSchema.safeParse({ containers: [], scannedAt: '2026-06-08T12:00:00.000Z' }).success).toBe(false);
  });
});
