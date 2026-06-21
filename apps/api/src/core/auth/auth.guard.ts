import { IS_PUBLIC_KEY } from '@api/common/decorators/public.decorator';
import { CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { fromNodeHeaders } from 'better-auth/node';
import { Request } from 'express';

import { AUTH_INSTANCE, AuthInstance } from './providers/auth.provider';

export interface AuthenticatedRequest extends Request {
  session?: NonNullable<AuthSession>;
}

export type AuthSession = Awaited<ReturnType<AuthInstance['api']['getSession']>>;

@Injectable()
export class AuthAppGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(AUTH_INSTANCE) private readonly authInstance: AuthInstance
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
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
