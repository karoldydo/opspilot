import { All, Controller, Inject, Req, Res } from '@nestjs/common';
import { toNodeHandler } from 'better-auth/node';
import { Request, Response } from 'express';

import { Public } from '../common/public.decorator';
import { AUTH_INSTANCE, AuthInstance } from './providers/auth.provider';

@Public()
@Controller('auth')
export class AuthController {
  constructor(@Inject(AUTH_INSTANCE) private readonly authInstance: AuthInstance) {}

  @All('*splat')
  handler(@Req() request: Request, @Res() response: Response): Promise<void> {
    return toNodeHandler(this.authInstance)(request, response);
  }
}
