import { All, Controller, Inject, Req, Res } from '@nestjs/common';
import { toNodeHandler } from 'better-auth/node';
import { Request, Response } from 'express';

import { AUTH_INSTANCE, AuthInstance } from './providers/auth.provider';

// thin pass-through: forwards the raw req/res to the better-auth node handler.
// '*splat' is a named wildcard — nest 11 runs on express 5 / path-to-regexp 8,
// where an unnamed '*' throws at route registration. effective mount is
// /api/auth/* (global '/api' prefix + @Controller('auth')).
@Controller('auth')
export class AuthController {
  constructor(@Inject(AUTH_INSTANCE) private readonly authInstance: AuthInstance) {}

  @All('*splat')
  handler(@Req() request: Request, @Res() response: Response): Promise<void> {
    return toNodeHandler(this.authInstance)(request, response);
  }
}
