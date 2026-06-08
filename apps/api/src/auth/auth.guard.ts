import { CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { fromNodeHeaders } from 'better-auth/node';
import { Request } from 'express';

import { IS_PUBLIC_KEY } from '../common/public.decorator';
import { AUTH_INSTANCE, AuthInstance } from './providers/auth.provider';

// request augmented with the validated session, attached by the guard so
// downstream handlers read the authenticated identity without re-querying.
export interface AuthenticatedRequest extends Request {
  session?: NonNullable<AuthSession>;
}

// the resolved session shape better-auth returns for a valid cookie; null when
// there is no session. derived from the instance so it never drifts from runtime.
export type AuthSession = Awaited<ReturnType<AuthInstance['api']['getSession']>>;

@Injectable()
export class AuthAppGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(AUTH_INSTANCE) private readonly authInstance: AuthInstance
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // allowlist is checked first so public surfaces never hit the session lookup.
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const session = await this.authInstance.api.getSession({ headers: fromNodeHeaders(request.headers) });
    if (!session) {
      throw new UnauthorizedException('valid session required');
    }

    // attach the validated session so handlers read the identity without re-querying.
    request.session = session;
    return true;
  }
}
