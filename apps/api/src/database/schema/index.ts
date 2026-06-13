// schema barrel — drizzle.config.ts points here as its generate target and the
// runtime drizzle(sqlite, { schema }) typing reads this module.
// the first domain tables (better-auth: user/session/account/verification) land
// in f-02, generated via @better-auth/cli (see ../../better-auth.config.ts).
export * from './auth.schema';
export * from './device.schema';
export * from './llm-provider.schema';
export * from './run-record.schema';
export * from './service.schema';
export * from './skill.schema';
