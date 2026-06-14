import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';

import { AuthAppGuard, AuthenticatedRequest } from './auth.guard';
import { AuthInstance } from './providers/auth.provider';

describe('AuthAppGuard', () => {
  let mockGetSession: ReturnType<typeof vi.fn>;
  let mockReflectorValue: boolean;
  let authGuard: AuthAppGuard;
  let actualRequest: AuthenticatedRequest;

  const mockContext = (request: AuthenticatedRequest): ExecutionContext =>
    ({
      getClass: () => class {},
      getHandler: () => () => undefined,
      switchToHttp: () => ({ getRequest: () => request }),
    }) as unknown as ExecutionContext;

  beforeEach(() => {
    mockGetSession = vi.fn();
    mockReflectorValue = false;
    actualRequest = { headers: {} } as AuthenticatedRequest;

    const reflector = { getAllAndOverride: () => mockReflectorValue } as unknown as Reflector;
    const authInstance = { api: { getSession: mockGetSession } } as unknown as AuthInstance;
    authGuard = new AuthAppGuard(reflector, authInstance);
  });

  it('allows a public route without consulting the session', async () => {
    mockReflectorValue = true;

    const actual = await authGuard.canActivate(mockContext(actualRequest));

    expect(actual).toBe(true);
    expect(mockGetSession).not.toHaveBeenCalled();
  });

  it('rejects a non-public route with no session (401)', async () => {
    mockReflectorValue = false;
    mockGetSession.mockResolvedValue(null);

    await expect(authGuard.canActivate(mockContext(actualRequest))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('allows a non-public route with a valid session and attaches it to the request', async () => {
    const expectedSession = { session: { id: 'sess-1' }, user: { id: 'user-1' } };
    mockReflectorValue = false;
    mockGetSession.mockResolvedValue(expectedSession);

    const actual = await authGuard.canActivate(mockContext(actualRequest));

    expect(actual).toBe(true);
    expect(actualRequest.session).toBe(expectedSession);
  });

  it('forwards the request headers to better-auth getSession', async () => {
    mockGetSession.mockResolvedValue(null);
    actualRequest = {
      headers: { cookie: 'better-auth.session_token=abc' },
    } as unknown as Request as AuthenticatedRequest;

    await expect(authGuard.canActivate(mockContext(actualRequest))).rejects.toBeInstanceOf(UnauthorizedException);
    expect(mockGetSession).toHaveBeenCalledWith({ headers: expect.any(Headers) });
  });
});
