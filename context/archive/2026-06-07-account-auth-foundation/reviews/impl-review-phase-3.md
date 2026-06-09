<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Account Auth Foundation (F-02)

- **Plan**: context/changes/account-auth-foundation/plan.md
- **Scope**: Phase 3 of 5
- **Date**: 2026-06-09
- **Verdict**: APPROVED
- **Findings**: 0 critical · 0 warnings · 1 observation

## Verdicts

| Dimension           | Verdict |
|---------------------|---------|
| Plan Adherence      | PASS    |
| Scope Discipline    | PASS    |
| Safety & Quality    | PASS    |
| Architecture        | PASS    |
| Pattern Consistency | PASS    |
| Success Criteria    | PASS    |

## Findings

### F1 — authUserSchema typuje timestampy jako ISO string (wire-level)

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — szybka decyzja; notatka pod Phase 5
- **Dimension**: Plan Adherence
- **Location**: libs/shared/src/lib/schemas/auth-user.schema.ts:8,15
- **Detail**: `createdAt`/`updatedAt` jako `z.iso.datetime()` są poprawne dla surowej odpowiedzi HTTP (JSON nie ma typu daty). Klient Better Auth (`authClient.getSession()`) zwykle deserializuje te pola do obiektów `Date`, więc walidacja obiektu z klienta wprost ISO-string schematem wywaliłaby `strict`-parse na `Date`. Kontrakt Phase 3 jest poprawny na poziomie wire; ryzyko dotyczy granicy klient↔kontrakt w Phase 5.
- **Fix**: Znormalizować timestampy tak, by schemat akceptował i ISO string, i `Date`, zachowując stringowy output (`z.preprocess(Date→toISOString, z.iso.datetime())`). Spójne ze stringową konwencją repo (`health-response.schema.ts`).
  - Strength: Kontrakt staje się odporny na oba źródła; `z.infer` pozostaje `string`; Phase 5 nie musi pamiętać o ręcznej konwersji.
  - Tradeoff: Minimalna logika preprocess w schemacie zamiast konwersji na granicy.
  - Confidence: HIGH — pokryte testem (`Date → ISO`), 18/18 zielonych.
  - Blind spot: Brak istotnych.
- **Decision**: FIXED + ACCEPTED-AS-RULE: Wire-level timestamps are ISO strings in shared Zod contracts — convert at the Better Auth client boundary (context/foundation/lessons.md)
