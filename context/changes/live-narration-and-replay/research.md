---
date: 2026-06-11T00:00:00+02:00
researcher: Karol Dydo
git_commit: f55ca800584020469f4837400aa9d0d0209735d9
branch: main
repository: opspilot
topic: "Live narration (SSE streaming) and replay (persistence) for the diagnose feature — architecture and integration points"
tags: [research, codebase, diagnose, sse, vercel-ai-sdk, drizzle, replay, contracts]
status: complete
last_updated: 2026-06-11
last_updated_by: Karol Dydo
---

# Research: Live narration and replay (S-05)

**Date**: 2026-06-11T00:00:00+02:00
**Researcher**: Karol Dydo
**Git Commit**: f55ca800584020469f4837400aa9d0d0209735d9
**Branch**: main
**Repository**: opspilot

## Research Question

Jak wpiąć w OpsPilot **live narration** (streaming syntezy diagnozy LLM token-po-tokenie przez SSE) oraz **replay** (persystencja przeszłych diagnoz i ich odtwarzanie), jak te dwie rzeczy się łączą, i czy warto/da się je osadzić na ogólniejszym mechanizmie narracji zdarzeń ops. Priorytet: architektura + konkretne punkty wpięcia, zgodnie z regułami repo (`sse.md`, `vercel-ai-sdk.md`, `drizzle.md`, `contracts.md`).

## Summary

- **Dziś wszystko jest batchowe i ephemeralne.** Funkcja diagnose to czysty request/response: `POST /api/devices/:deviceId/services/:serviceId/diagnose` → `generateText` + `Output.object` (jeden blocking await) → pełny `DiagnosisSynthesis` naraz. **Nic nie streamuje** (zero `@Sse`, `streamText`, `EventSource` w całym `apps/`) i **nic nie jest zapisywane** — kod jawnie komentuje: *"ephemeral (no run-record persistence — that is s-09)"* (`apps/api/src/diagnose/diagnose.service.ts:28`).
- **Reguły i zależności pod streaming już istnieją, tylko niewpięte.** `sse.md` precyzyjnie dyktuje wzorzec (`@Sse()` Observable w **service**, heartbeat `: ping` co ~30 s, `X-Accel-Buffering: no` + `Cache-Control: no-cache`, klient `EventSource` → signal → teardown przez `DestroyRef`). `ai@^6` + `@ai-sdk/openai-compatible@^2`, `rxjs`, zoneless Angular i `@ngrx/signals` store są już na miejscu.
- **Cloudflare to znany trap.** Deploy jest za Cloudflare Access (MEMORY.md). `roadmap.md:184` ostrzega wprost: bez heartbeatów + anty-buforujących nagłówków od pierwszego dnia, runy > ~100 s są cicho ucinane na edge. To load-bearing wymóg, nie optymalizacja.
- **Replay ma krytyczną lukę: tabela run-record/transcript NIE istnieje.** Została odroczona z S-04. Roadmap zakłada, że *"run records originate in S-04"*, ale fizycznie ich nie ma. **S-05 (replay) wymaga tej tabeli — albo S-05 ją tworzy, albo zależy od S-09.** To pierwsza decyzja zakresu do podjęcia w `/10x-frame`/`/10x-plan`.
- **Maszyneria DB jest gotowa.** `@Global` database module, schema barrel, drizzle-kit, auto-migracje na boot z WAL-aware backupem — dodanie tabeli diagnoz to wydeptana ścieżka (nowy `*.schema.ts` → `db:generate` → migracja `0004_*.sql` odpala się sama na boot i pakuje się webpackiem).
- **Kontrakt-first jest nienegocjowalny.** Każdy nowy kształt (event narracji SSE, transcript/run-record) = jeden Zod schema w `@opspilot/shared`, konsumowany przez `z.infer` po obu stronach. Linia api↔web jest egzekwowana lintem.

## Detailed Findings

### Obecna funkcja diagnose (baza do rozszerzenia)

**API — orkiestracja (slice S-04):**
- Controller: `apps/api/src/diagnose/diagnose.controller.ts:9-16` — `@Controller('devices/:deviceId/services/:serviceId')` + `@Post('diagnose')`, **bez body**, zwraca `Promise<DiagnosisSynthesis>`, deleguje 1:1 do service. Cienki HTTP boundary.
- Service: `apps/api/src/diagnose/diagnose.service.ts:29-50` — przebieg: `serviceService.findOne` (404 jeśli cudzy/brak) → **fail-fast** `llmProviderService.getActiveProviderConfig()` PRZED round-tripem SSH (`:35`, brak aktywnego providera = 409 zanim zapłacimy za fetch logów) → `fetchLogs` over SSH → `clientFactory.create(...).synthesize(...)`.
- Synteza: `diagnose.service.ts:90-114` — **Vercel AI SDK**, `generateText({ output: Output.object({ schema: diagnosisSynthesisSchema }) })` (`:96-101`), `abortSignal: AbortSignal.timeout(generateTimeoutMs)`. **Nie streamuje** — zwraca cały `output` jednym `return`. (Uwaga: `vercel-ai-sdk.md` mówi `generateObject`; kod świadomie używa `generateText`+`Output.object` — `generateObject` deprecated w AI SDK v6.)
- Provider factory: `apps/api/src/llm-provider/llm-provider.client-factory.ts:16-24` — `createOpenAICompatible({ apiKey, baseURL, name: kind, supportsStructuredOutputs: true })`. Flaga `supportsStructuredOutputs: true` wymusza prawdziwy `response_format: json_schema` na drucie.
- Fetch logów: `diagnose.service.ts:57-84` — re-walidacja `containerNameSchema.parse(containerName)` na shell-boundary (defence-in-depth, fix z commita `2d79607`), komenda `docker logs ${containerName} --tail N` z PATH-prefixem Synology, `Promise.race` z `DiagnosisLogsTimeoutError` (~5 s).
- Taksonomia błędów: `apps/api/src/diagnose/diagnose.errors.ts` — `DiagnosisLogsTimeoutError`→504, `DiagnosisSynthesisError`→502, `DiagnosisTimeoutError`→504, `mapLogsError`→503. **Świadomie nigdy 401** (401 odpaliłby web session-expiry interceptor).
- Tunable w config-layer: `apps/api/src/config/llm.config.ts` — `LLM_GENERATE_TIMEOUT_MS` (12000), `LLM_DIAGNOSE_LOGS_TAIL` (200), `LLM_DIAGNOSE_LOGS_TIMEOUT_MS` (5000).

**Web — 3-warstwowy wzorzec (do skopiowania):**
- Komponent: `apps/web/src/app/features/services/device-services.component.ts:34,47,74-76` — store provided **na poziomie komponentu** (`providers: [DiagnosisClient, DiagnosisStore]`), nie `providedIn: 'root'`; keyed per device-row.
- Panel: `device-services.component.html:25-91` — `@let diag = diagnosis.entry(service.id)`, przycisk `[disabled]="diag.loading"`, warunkowy `<tr>` z error/result. **Brak streamu** — binarny stan loading→result.
- Klient: `apps/web/src/app/core/clients/diagnosis.client.ts:15-19` — `firstValueFrom(http.post(...))` + `diagnosisSynthesisSchema.parse(row)` na boundary. Plain POST.
- Store: `apps/web/src/app/core/stores/diagnosis.store.ts:51-82` — `@ngrx/signals` `signalState` + `patchState` (zoneless-friendly), keyed per `serviceId`, `DiagnosisEntry = { error, loading, result }`. **To właściwy kontener na inkrementalne patche tokenów.**

**Shared — kontrakt:**
- `libs/shared/src/lib/schemas/diagnosis-synthesis.schema.ts:11-18` — `z.strictObject({ problems: string[], status: enum['healthy','degraded','down'], suggestions: string[], summary: string })` + `z.infer`. Ten sam schema jest jednocześnie `Output.object` dla LLM i parse-boundary na FE. **Brak typu eventu/delty/chunku** — nie ma czym reprezentować strumienia.
- `libs/shared/src/lib/schemas/container-name.schema.ts:9-12` — `z.string().min(1).regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/)`.

**Ocena dystansu do live narration:** daleko. Cała ścieżka to `Promise<DiagnosisSynthesis>`; brak prymitywu strumienia na każdej z trzech warstw. Ale seam jest czysty i dobrze wyizolowany.

### Live narration — wzorzec wymuszony przez reguły

**`.claude/rules/sse.md`** (auto-attach na `apps/api/**` i `apps/web/**`):
- Transport: SSE jest **default**; WebSocket to fallback tylko jeśli heartbeaty nie wystarczą (`sse.md:6-10`).
- Server: *"Expose the stream with NestJS `@Sse()` returning an `Observable<MessageEvent>` straight from a service; the controller is **pass-through only** — heartbeat, event mapping, and stream logic live in the **service**, never in the handler."* (`sse.md:12-19`). Heartbeat `: ping\n\n` co ~30 s. Nagłówki `X-Accel-Buffering: no` + `Cache-Control: no-cache`.
- Client: *"Consume with the native **`EventSource`** and push events into a **signal** ... Always tear the stream down: `destroyRef.onDestroy(() => source.close())`"* (`sse.md:21-26`).

**`.claude/rules/vercel-ai-sdk.md`** (auto-attach na `apps/api/**`, tylko server):
- *"Route SSH-backed skills through the executor abstraction; **stream long-running runs over SSE** (see `sse.md`)."* (`vercel-ai-sdk.md:16-22`) — to jawny hook na live narration.
- Constraint: *"Do NOT add a free-form chat/prompt entry point; the agent runs only predefined skills, scoped to the target device."*

**Mechanika NestJS 11 (Express 5, webpack `target: node`):** `@Sse()` zwraca `Observable<MessageEvent>`; Nest sam ustawia `text/event-stream` i serializuje ramki. Heartbeat = RxJS `merge`/`interval` emitujący `: ping` z **service**.

**Vercel AI SDK v6 — co użyć:**
- `streamObject({ schema, model, prompt })` — strumieniowy analog obecnego `generateText`+`Output.object`; wystawia `partialObjectStream` (async iterable progresywnie wypełnianych partiali `diagnosisSynthesisSchema`) + `textStream`. Naturalne źródło tokenów dla 4-polowej syntezy, trzyma regułę "single fixed schema".
- `streamText({ model, prompt })` — `textStream`/`fullStream`; jeśli narracja ma być free-text zamiast structured partials.
- **NIE używać** `toDataStreamResponse()`/`toUIMessageStreamResponse()` — są pod Web `Response` (fetch/Next.js), nie komponują się z `@Sse → Observable<MessageEvent>`. Rule-compliant ścieżka: w **service** iterować `partialObjectStream` (lub `textStream`) przez `for await`, mapować deltę na `MessageEvent`, merge z 30 s heartbeatem, zwrócić Observable do cienkiego `@Sse` controllera.
- Uwaga: `supportsStructuredOutputs: true` (`client-factory.ts:9-15`) zmienia semantykę `NoObjectGeneratedError`/timeout przy `streamObject` — istniejąca klasyfikacja błędów (`diagnose.service.ts:103-167`) potrzebuje streaming-aware odpowiednika.

**Angular consumption — zoneless potwierdzony:** `apps/web/src/app/app.config.ts:9-22` nie ma `provideZoneChangeDetection` (Angular 21 zoneless by default; `zone.js` w `package.json` ale niewpięty). Konsumpcja: native `EventSource` → patch `entries[serviceId]` na każdej delcie → teardown `DestroyRef.onDestroy`. `httpResource()`/`HttpClient` to tylko request/response — reguła celowo kieruje streaming przez `EventSource`. `@ai-sdk/angular`/`useChat` **nie są zainstalowane** i nie są przepisaną ścieżką (AI SDK scoped tylko na server).

### Replay — persystencja (Drizzle/SQLite)

**`.claude/rules/drizzle.md`:** Drizzle ORM nad SQLite (WAL) via `better-sqlite3` (synchroniczny, bez `await` na driverze). Tabele w `*.schema.ts`; zmiany schematu **tylko przez drizzle-kit migracje** ("never mutate the live DB by hand"). **"Index every column used in a `where`/`order by`"**, paginuj każdą listę (`.limit()/.offset()`, no unbounded scans). Jeden injectable provider połączenia (app-scoped). **Typy `$inferSelect/$inferInsert` NIE mogą wyciekać do `@opspilot/shared`** — wiersze mapować na shared Zod kontrakt przed zwrotem.

**Gotowa maszyneria DB:**
- Connection provider: `apps/api/src/database/providers/database-connection.provider.ts` — token `DATABASE_CONNECTION`, `new Database(path)`, `pragma WAL` + `foreign_keys ON`, `drizzle(sqlite, { schema })`.
- `@Global` module: `database.module.ts:9-12` eksportuje `DATABASE_CONNECTION`; serwisy wstrzykują przez `@Inject(DATABASE_CONNECTION)`.
- Schema barrel: `apps/api/src/database/schema/index.ts:5-8` (auth, device, llm-provider, service).
- drizzle-kit config: `apps/api/drizzle.config.ts` (`dialect: sqlite`, `out: ./migrations`, `url` z `DATABASE_PATH`). 4 migracje już istnieją (`0000…0003`).
- Auto-migrate na boot: `apps/api/src/database/migration/migration.service.ts:24-38` (`OnApplicationBootstrap`) — backup gate (snapshot tylko gdy są pending migracje, WAL-aware `$client.backup`) + `migrate(...)`. Pruning trzyma `backupRetention` snapshotów (`:82-91`).
- Pakowanie migracji do bundla: `apps/api/webpack.config.js:22` (`assets: [{ input: './migrations', output: 'migrations' }]`).

**Wzorzec CRUD service do skopiowania** (`apps/api/src/llm-provider/llm-provider.service.ts`):
- Lokalny `type Row = typeof table.$inferSelect` (nie eksportowany).
- `@Inject(DATABASE_CONNECTION) private readonly db` (explicit token — lekcja: esbuild gubi `design:paramtypes`).
- `randomUUID()` na ID, `.insert().values().returning().get()`, `.update().set().where().returning().get()`.
- **Compute-then-write invariant w JEDNEJ transakcji** `this.db.transaction((tx) => {...})` (lekcja z `lessons.md:34-38`).
- `requireRow` → `NotFoundException(\`… ${id} not found\`)`.
- `toContract(row)` — rzutuje tylko bezpieczne pola (nigdy spread wiersza), `schema.parse(...)` normalizuje `timestamp_ms` → ISO.
- Lista z `.limit(limit).offset(offset)` (domyślny limit z configa).

**Tunable retencji** (wzorzec `lessons.md:5-10`): pole w `config/env.schema.ts` (typowane + Joi `.min().default()`) → namespace `config/*.config.ts` z `Number(...)` → `@Inject(<config>.KEY)`. Precedens: `DATABASE_BACKUP_RETENTION` → `databaseConfig.backupRetention` → `migration.service.ts:88`. **Retencja diagnoz NIE jako module-level `const`.**

### Kontrakty i granice modułów

**`.claude/rules/contracts.md`** (anchor rule): *"Every request/response shape and every domain type is defined **once** as a Zod schema in `libs/shared`. Both apps **consume** that schema — they never declare a parallel interface/type."* (`contracts.md:16-18`); *"Derive types with `z.infer` — do not hand-maintain a separate type."* (`:21-22`). Shared = tylko schematy + czyste funkcje, **zero I/O, zero `@angular/*`/`@nestjs/*`** (`:31`). Drizzle `$infer*` NIE wchodzi do shared (`:33-38`).

**Struktura `libs/shared`:** płaski `src/lib/schemas/`, `<name>.schema.ts`, jeden export/plik, barrel `src/index.ts` z alfabetycznym `export *` (perfectionist lint). Persisted entity (np. transcript/run-record) używa wzorca `isoTimestamp` preprocess z `llm-provider.schema.ts:6,13-22` (Date z Drizzle ↔ ISO na wire) + `z.strictObject` odrzucający wyciek sekretów. Zod **v4** (`z.enum()` top-level, `z.strictObject()`, `error:` nie `message:`).

**Granice:** `eslint.config.mjs:17-37` — `@nx/enforce-module-boundaries`, scope tagi `scope:shared|api|web`, import zawsze przez `@opspilot/shared`. Logika SSE (server `@Sse()` Observable) w api, konsumpcja (`EventSource`→signal) w web; przekroczenie linii api↔web = błąd lintu.

## Code References

- `apps/api/src/diagnose/diagnose.controller.ts:9-16` — endpoint `@Post('diagnose')`, thin pass-through, zwraca `Promise<DiagnosisSynthesis>` (do zamiany/uzupełnienia o `@Sse`)
- `apps/api/src/diagnose/diagnose.service.ts:29-50` — orkiestracja diagnozy (fail-fast provider, fetch logów, synteza)
- `apps/api/src/diagnose/diagnose.service.ts:90-114` — `generateText` + `Output.object` (punkt zamiany na `streamObject`/`streamText`)
- `apps/api/src/diagnose/diagnose.service.ts:28` — komentarz "ephemeral (no run-record persistence — that is s-09)"
- `apps/api/src/diagnose/diagnose.errors.ts` — taksonomia 5xx (potrzebny streaming-aware odpowiednik)
- `apps/api/src/llm-provider/llm-provider.client-factory.ts:16-24` — `createOpenAICompatible(... supportsStructuredOutputs: true)`
- `apps/api/src/llm-provider/llm-provider.service.ts` — wzorzec CRUD service (transakcja, `toContract`, `requireRow`) do skopiowania pod run-record
- `apps/api/src/database/providers/database-connection.provider.ts` — `DATABASE_CONNECTION`, drizzle + WAL
- `apps/api/src/database/schema/index.ts:5-8` — schema barrel (dodać tu `diagnosis`/`run` schema)
- `apps/api/src/database/migration/migration.service.ts:24-38` — auto-migrate na boot + backup gate
- `apps/api/src/config/llm.config.ts`, `apps/api/src/config/env.schema.ts` — wzorzec tunable (timeouty, retencja)
- `apps/web/src/app/core/clients/diagnosis.client.ts:15-19` — POST + parse-at-boundary (do augmentacji o `EventSource`)
- `apps/web/src/app/core/stores/diagnosis.store.ts:51-82` — `signalState` keyed per serviceId (kontener na inkrementalne patche)
- `apps/web/src/app/features/services/device-services.component.{ts,html}` — przycisk + panel (do rozszerzenia o widok narracji/replay)
- `apps/web/src/app/app.config.ts:9-22` — zoneless potwierdzony
- `libs/shared/src/lib/schemas/diagnosis-synthesis.schema.ts:11-18` — fixed-output schema
- `libs/shared/src/lib/schemas/llm-provider.schema.ts:6,13-22` — wzorzec persisted entity + `isoTimestamp`
- `libs/shared/src/index.ts` — barrel (alfabetyczne `export *`)
- `.claude/rules/sse.md`, `.claude/rules/vercel-ai-sdk.md`, `.claude/rules/drizzle.md`, `.claude/rules/contracts.md` — load-bearing reguły

## Architecture Insights

- **Trzy warstwy, jeden kontrakt.** Diagnose feature jest wzorcowym pionowym slice'em: cienki controller → service z logiką → shared Zod kontrakt parsowany na obu boundary. Każde rozszerzenie (event narracji, transcript) podąża tym samym kształtem — nowy schema w shared first, potem api emituje, web konsumuje.
- **Heartbeat + anty-bufor to wymóg dnia 1, nie polish.** Cloudflare edge ucina ciche idle streamy > ~100 s. `roadmap.md:184` traktuje to jako "known deploy trap". WebSocket jest udokumentowanym fallbackiem, ale SSE z heartbeatem jest ścieżką domyślną.
- **Stream i zapis z jednego źródła.** Naturalna architektura: service iteruje `partialObjectStream`/`textStream`, jednocześnie (a) mapuje deltę na `MessageEvent` dla `@Sse` (live), (b) akumuluje pełny transcript i na `done` zapisuje run-record do DB (replay). Jeden przebieg LLM zasila i live, i persystencję — dokładnie to, co PRD nazywa "small add-on over existing data" (`prd.md:94`).
- **Store jest gotowy na strumień.** `@ngrx/signals` `signalState` keyed per-id, provided na komponencie — wystarczy rozszerzyć `DiagnosisEntry` o pole na akumulowaną narrację/partial; zoneless gwarantuje, że async patche z `EventSource` propagują się przez signale.
- **Structured output vs swobodna narracja to realny trade-off.** Obecny `Output.object` wymusza sztywny 4-polowy obiekt. Live narration tokenów to albo `streamObject` (partial structured — trzyma kontrakt, ale "narracja" = progresywne wypełnianie pól), albo `streamText` obok finalnego structured output (prawdziwa swobodna narracja + osobny finalny obiekt). Wybór wpływa na kształt eventu w shared i na klasyfikację błędów.

## Historical Context (from prior changes)

- `context/archive/2026-06-11-diagnose-service-synthesis/` (**S-04**, bezpośredni poprzednik) — `research.md:172`: *"Synthesis-only, no streaming. ... Live narration/SSE is split to S-05 — keep it out."*; `plan-brief.md:51` listuje streaming/SSE jako out-of-scope. Run-record persistence odroczona (`frame.md:26-28`). **Kluczowe napięcie:** `research.md:115,183` — roadmap mówi *"Run records originate in S-04"*, ale tabela NIE powstała; S-05 i S-09 oba od niej zależą.
- `context/archive/2026-06-10-configure-llm-provider/` (**S-03**) — encrypted provider storage, single-active invariant, `getActiveProviderConfig`, factory `createOpenAICompatible`. Odroczył warstwę AI SDK do S-04.
- `context/archive/2026-06-10-scan-and-add-services/` (**S-02**) — `IExecutor` SSH abstraction + async-mutex per-device, tabela `service` (`containerName`, `deviceId`), PATH-prefix gotcha Synology.
- `context/archive/2026-06-09-encrypted-credential-store/` (**F-03**) — crypto/credential contract.

**Foundation:**
- `roadmap.md:53,175-185` — S-05 `live-narration-and-replay`, status `proposed`, prereq S-04: *"a user watches an agent run narrated live and can replay the full saved transcript of an earlier run"*; ref US-01, FR-010. Ryzyko SSE/Cloudflare na `:184`.
- `prd.md:55-56,94` — US-01 acceptance: *"run narration is visible live during execution / The full transcript is saved and can be replayed"*; FR-010 (must-have).
- `roadmap.md:223-234` — S-09 audit-log-and-history: *"Run records originate in S-04; this slice adds the user-action side, the linkage, and the view."*
- `tech-stack.md:32,43-44` — *"REST + SSE on the backend, Drizzle ORM over SQLite (WAL)"*; persistent Node server uzasadniony m.in. SSE narration.
- `lessons.md` — relevantne: tunable w config-layer (`:5-10`), explicit `@Inject` (`:19-24`), compute-then-write w jednej transakcji (`:34-38`), Date↔ISO na boundary (`:12-17`).

## Related Research

- `context/archive/2026-06-11-diagnose-service-synthesis/research.md` — najbliższy poprzednik; szczegóły AI SDK v6, taksonomii błędów, szkic tabeli run-record (`:115`).
- `context/archive/2026-06-10-configure-llm-provider/research.md` — warstwa provider/credential.

## Open Questions

1. **Zakres persystencji (KRYTYCZNA decyzja).** Czy S-05 tworzy tabelę run-record/transcript (bo replay jej wymaga, a nie istnieje), czy replay zależy od osobnego dostarczenia w S-09? Rekomendacja: S-05 tworzy minimalną tabelę diagnoz (id, FK deviceId/serviceId, 4 pola syntezy + opcjonalnie surowy transcript narracji, createdAt, indeksy), S-09 ją rozszerza o user-action side i linkage.
2. **`streamObject` vs `streamText` + final object.** Czy "narracja" to progresywne wypełnianie 4-polowego obiektu (`streamObject`, trzyma kontrakt jednoznacznie), czy swobodny tekst narracji równolegle do finalnego structured output (`streamText` + osobny `done` z obiektem)? Wpływa na kształt `narration-event.schema.ts`.
3. **Kształt eventu SSE.** Jeden Zod union (`{ type: 'delta'|'done'|'error', ... }`) w shared? Jak reprezentować partial structured object na drucie (ISO/JSON). Czy heartbeat `: ping` jest komentarzem SSE (nie eventem domenowym) — tak, zgodnie z `sse.md`.
4. **Streaming-aware obsługa błędów.** Jak zmapować błędy w trakcie strumienia (timeout, `NoObjectGeneratedError`, zerwane połączenie) na event `error` w strumieniu vs status HTTP (przy `@Sse` połączenie już otwarte z 200). Czy zachować fail-fast provider-check PRZED otwarciem strumienia.
5. **Replay = re-stream czy statyczny render?** Czy odtworzenie zapisanej diagnozy renderuje finalny transcript naraz (prościej), czy "odgrywa" narrację z oryginalnym tempem (więcej kodu, wątpliwa wartość). Rekomendacja: statyczny render finalnego transcriptu — replay to przegląd, nie reprodukcja.
6. **Retencja.** Ile diagnoz trzymać per service/globalnie? Tunable `DIAGNOSIS_HISTORY_RETENTION` w config-layer; pruning analogiczny do backup-retention. Czy w ogóle limitować w S-05, czy zostawić na S-09.
7. **Ogólniejszy mechanizm narracji.** Czy event/transcript kontrakt projektować od razu generycznie (pod przyszłe skille agenta, nie tylko diagnose), zgodnie z `vercel-ai-sdk.md` "predefined skills"? Ryzyko przeinżynierowania vs późniejsza migracja kontraktu. Rekomendacja: nazwać kontrakt neutralnie (`run`/`narration`, nie `diagnosis-stream`), ale nie budować abstrakcji ponad jeden istniejący skill.
