import { AuthenticatedRequest } from '@api/core/auth/auth.guard';
import { createParamDecorator, ExecutionContext } from '@nestjs/common';

// accessor for the guard-attached session user id: AuthAppGuard validates every
// non-public route and attaches request.session (auth.guard.ts), so it's already here — no re-query.
export const CurrentUserId = createParamDecorator((_data: unknown, ctx: ExecutionContext): string | undefined => {
  const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
  return request.session?.user.id;
});
