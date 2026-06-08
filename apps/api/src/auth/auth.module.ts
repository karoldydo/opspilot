import { Module } from '@nestjs/common';

import { AuthController } from './auth.controller';
import { AUTH_INSTANCE, authProvider } from './providers/auth.provider';

@Module({
  controllers: [AuthController],
  exports: [AUTH_INSTANCE],
  providers: [authProvider],
})
export class AuthModule {}
