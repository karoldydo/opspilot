import { ExecutionContext } from '@nestjs/common';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';

import { AuthenticatedRequest } from '../auth/auth.guard';
import { CurrentUserId } from './current-user-id.decorator';

// createParamDecorator stores its factory in route-args metadata; pull it back out
// so the resolution logic can be exercised directly with a mock execution context.
function getParamFactory(): (data: unknown, ctx: ExecutionContext) => unknown {
  class Probe {
    handler(@CurrentUserId() _userId: string): void {
      void _userId;
    }
  }
  const metadata = Reflect.getMetadata(ROUTE_ARGS_METADATA, Probe, 'handler');
  return metadata[Object.keys(metadata)[0]].factory;
}

function mockContext(request: Partial<AuthenticatedRequest>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('CurrentUserId', () => {
  it('returns the guard-attached session user id', () => {
    const factory = getParamFactory();
    const actual = factory(
      undefined,
      mockContext({ session: { user: { id: 'user-1' } } } as Partial<AuthenticatedRequest>)
    );

    expect(actual).toBe('user-1');
  });

  it('returns undefined when no session is attached', () => {
    const factory = getParamFactory();
    const actual = factory(undefined, mockContext({}));

    expect(actual).toBeUndefined();
  });
});
