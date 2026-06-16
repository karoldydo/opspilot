import { AppModule } from '@api/app.module';
import { IS_PUBLIC_KEY } from '@api/common/decorators/public.decorator';
import { cryptoConfig } from '@api/config/crypto.config';
import { databaseConfig } from '@api/config/database.config';
import { AuthController } from '@api/core/auth/auth.controller';
import { AUTH_INSTANCE } from '@api/core/auth/providers/auth.provider';
import { HealthController } from '@api/core/health/health.controller';
import { INestApplication } from '@nestjs/common';
import { DiscoveryModule, DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import request from 'supertest';

// wire-level proof of the global APP_GUARD. the controller specs deliberately
// strip the guard and fake the session, so no test asserts unauth→401 over real
// http today. this boots the real AppModule once (the only way to get the
// production APP_GUARD + the real route list) and runs two blocks off that boot:
// (a) a supertest 401 sweep across every operational module plus a public-route
// control and a positive session control, and (b) a DiscoveryService metadata
// sweep that pins the @Public allowlist to exactly Auth + Health — so a stray
// @Public() on an operational controller fails the suite.
describe('Auth boundary (e2e)', () => {
  // a fixed 32-byte key (0x01 * 32) base64-encoded to 44 chars.
  const inputKey = 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=';

  let moduleRef: TestingModule;
  let app: INestApplication;
  let dbPath: string;

  // a mutable session lets one boot drive both null (401 path) and a session
  // object (pass-through positive control). the guard reads authInstance.api.getSession.
  let sessionValue: unknown = null;
  const fakeAuth = { api: { getSession: vi.fn(async () => sessionValue) } };

  function cleanupTempFiles(): void {
    const dir = dirname(dbPath);
    const base = basename(dbPath);
    for (const file of readdirSync(dir)) {
      if (file.startsWith(base)) {
        rmSync(join(dir, file));
      }
    }
  }

  beforeAll(async () => {
    dbPath = join(tmpdir(), `opspilot-auth-boundary-test-${process.pid}-${Date.now()}.db`);
    moduleRef = await Test.createTestingModule({
      // DiscoveryModule exposes DiscoveryService + MetadataScanner for the block-B
      // @Public metadata sweep; it scans the whole container, AppModule included.
      imports: [AppModule, DiscoveryModule],
    })
      .overrideProvider(databaseConfig.KEY)
      .useValue({ backupRetention: 5, path: dbPath })
      .overrideProvider(cryptoConfig.KEY)
      .useValue({ encryptionKey: inputKey })
      .overrideProvider(AUTH_INSTANCE)
      .useValue(fakeAuth)
      .compile();
    app = moduleRef.createNestApplication();
    // replicate the production global prefix so paths match (main.ts:12-13).
    app.setGlobalPrefix('api');
    // app.init() triggers onApplicationBootstrap, which runs the migrations.
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    cleanupTempFiles();
  });

  const server = () => app.getHttpServer();

  describe('401 sweep (block A)', () => {
    beforeEach(() => {
      sessionValue = null;
    });

    // one representative operational route per module — the guard short-circuits
    // before any param/body validation, so placeholder ids are fine.
    const operationalRoutes: ReadonlyArray<{ method: 'get' | 'post'; module: string; path: string }> = [
      { method: 'get', module: 'device', path: '/api/devices' },
      { method: 'get', module: 'service', path: '/api/devices/dev_x/services' },
      { method: 'get', module: 'skill', path: '/api/skills' },
      { method: 'post', module: 'skill-run', path: '/api/devices/dev_x/services/svc_x/skills/skill_x/run' },
      { method: 'get', module: 'llm-provider', path: '/api/llm-providers' },
      { method: 'get', module: 'audit', path: '/api/audit' },
      { method: 'get', module: 'diagnose', path: '/api/devices/dev_x/services/svc_x/diagnose/runs' },
    ];

    it.each(operationalRoutes)(
      'rejects an unauthenticated $method $path ($module) with the canonical 401 envelope',
      async ({ method, path }) => {
        const res = await request(server())[method](path).expect(401);
        expect(res.body).toEqual({
          message: 'valid session required',
          status: 401,
          timestamp: expect.any(String),
        });
      }
    );

    it('lets the public health route through without a session', async () => {
      await request(server()).get('/api/health').expect(200);
    });

    it('positive control: a valid session passes the guard (route is not blanket-401)', async () => {
      // flip the fake to a session object — the same route that 401s above must
      // now reach its handler, proving the sweep is not a tautology.
      sessionValue = { session: { id: 'sess-boundary' }, user: { id: 'user-boundary' } };
      await request(server()).get('/api/devices').expect(200);
    });
  });

  describe('@Public sweep (block B)', () => {
    it('exposes exactly AuthController and HealthController as public', () => {
      const discovery = app.get(DiscoveryService);
      const scanner = app.get(MetadataScanner);
      const reflector = app.get(Reflector);

      // enumerate every controller handler and collect the owning class whenever
      // the @Public metadata (handler- or class-level) resolves truthy.
      const publicControllers = new Set<unknown>();
      for (const wrapper of discovery.getControllers()) {
        const { instance, metatype } = wrapper;
        if (!instance || !metatype) {
          continue;
        }
        const prototype = Object.getPrototypeOf(instance);
        for (const methodName of scanner.getAllMethodNames(prototype)) {
          const handler = prototype[methodName];
          const isPublic = reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [handler, metatype]);
          if (isPublic) {
            publicControllers.add(metatype);
          }
        }
      }

      expect(publicControllers).toEqual(new Set([AuthController, HealthController]));
    });
  });
});
