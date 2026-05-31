import { Module } from '@nestjs/common';

import { HealthController } from './health.controller';
import { HealthService } from './health.service';

// thin health slice: the db connection comes from the @Global() DatabaseModule,
// so this module only wires its own controller + service.
@Module({
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}
