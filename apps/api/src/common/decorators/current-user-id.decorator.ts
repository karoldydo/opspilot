import { AuthenticatedRequest } from '@api/auth/auth.guard';
import { createParamDecorator, ExecutionContext } from '@nestjs/common';

// ergonomic accessor for the guard-attached session user id. the global
// AuthAppGuard validates every non-public route and attaches request.session
// (auth.guard.ts), so the id is already present here — no re-query. mirrors the
// placement/style of public.decorator.ts.
export const CurrentUserId = createParamDecorator((_data: unknown, ctx: ExecutionContext): string | undefined => {
  const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
  return request.session?.user.id;
});
