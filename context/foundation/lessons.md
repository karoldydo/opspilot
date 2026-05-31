# Lessons Learned

> Append-only register of recurring rules and patterns. Re-read at start by /10x-frame, /10x-research, /10x-plan, /10x-plan-review, /10x-implement, /10x-impl-review.

## Put operational tunables in the config layer, never as in-file `const`s

- **Context**: `apps/api` NestJS services — any operational tunable (retention count, limit, timeout, interval, threshold) about to be written as a module-level `const`.
- **Problem**: A baked-in literal needs a code edit + rebuild to change and sits outside the one place the project validates configuration (`nestjs.md`: "no `process.env` outside the config layer"); a later override can silently become `NaN` instead of failing at boot. Surfaced when `const BACKUP_RETENTION = 5` lived inside `migration/migration.service.ts`.
- **Rule**: Route operational tunables through `@nestjs/config` + Joi: add the var to `config/env.schema.ts` (typed in `EnvConfig`, bounded + defaulted in the Joi schema so a bad value fails fast at boot), surface it on the relevant `registerAs(...)` namespace in `config/*.config.ts` (coerce numerics with `Number(...)` — Joi writes defaults back to `process.env` as strings), then read it via the injected typed config (`this.config.<field>`) and add the field to any `.overrideProvider(<config>.KEY).useValue({ ... })` in specs.
- **Applies to**: plan, implement, impl-review
