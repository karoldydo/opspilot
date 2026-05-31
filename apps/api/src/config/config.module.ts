import { Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';

import { databaseConfig } from './database.config';
import { envSchema } from './env.schema';

@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      load: [databaseConfig],
      validationOptions: { abortEarly: false, allowUnknown: true },
      validationSchema: envSchema,
    }),
  ],
})
export class ConfigModule {}
