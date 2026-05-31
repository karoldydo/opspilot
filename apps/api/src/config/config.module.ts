import { Global, Module } from '@nestjs/common';

import { ConfigService } from './config.service';

// @Global so any module injects ConfigService without re-importing this module.
@Global()
@Module({
  exports: [ConfigService],
  providers: [ConfigService],
})
export class ConfigModule {}
