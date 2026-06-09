import { Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';

import { authConfig } from './auth.config';
import { cryptoConfig } from './crypto.config';
import { databaseConfig } from './database.config';
import { envSchema } from './env.schema';

@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      load: [authConfig, cryptoConfig, databaseConfig],
      validationOptions: { abortEarly: false, allowUnknown: true },
      validationSchema: envSchema,
    }),
  ],
})
export class ConfigModule {}
