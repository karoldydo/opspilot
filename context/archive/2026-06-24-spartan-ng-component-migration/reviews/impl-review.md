<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Spartan-ng Component Migration

- **Plan**: context/changes/spartan-ng-component-migration/plan.md
- **Scope**: wszystkie 5 faz (pełny plan)
- **Date**: 2026-06-24
- **Verdict**: NEEDS ATTENTION (migracja technicznie czysta; dwie decyzje projektowe wokół styli przycisków — obie rozstrzygnięte w triage)
- **Findings**: 0 critical · 2 warnings · 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

## Kontekst uwagi użytkownika (utrata styli przycisków)

`apps/web/src/styles.scss:109-135` repointuje semantyczne tokeny helm na paletę OpsPilota
(`--primary` = op-ink `#201d1d`, `--primary-foreground` = op-cream `#fdfcfc`, `--destructive`
= op-danger `#ff3b30`, `--border` = op-hairline, `--radius-sm/md` = 4px). Dzięki temu `hlmBtn`
nie renderuje się „nieostylowany" — kolory i radius są zachowane. Wariant `destructive` w tym
repo jest subtelny (`bg-destructive/10 + text-destructive`, `libs/ui/button/src/lib/hlm-button.ts:32`),
więc dobrze pasuje do starego obwódkowego „delete". Faktyczna różnica to mikro-metryki
(wysokość/padding/font-size) + jeden usunięty przycisk w audycie.

## Findings

### F1 — Bespoke metryki przycisków zastąpione domyślnymi hlmBtn

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — realny kompromis; to widoczna zmiana, którą zgłosił użytkownik
- **Dimension**: Pattern Consistency
- **Location**: service-detail.component.html (edit/delete/re-run), login/register submit, i in.
- **Detail**: Stare przyciski miały ręcznie dobrane wymiary z makiety `.dc.html` (np. re-run
  `px-4 py-[9px] text-[13px]`, edit/delete `px-[13px] py-[5px] text-xs`, login submit `h-[38px]`).
  Po migracji używają domyślnych rozmiarów hlmBtn (`h-9`/`h-8`, `px-2.5`, `text-sm`). Kolory,
  radius i `font-medium` zachowane przez repoint tokenów; różnica to ~2px niższe i ciaśniejsze
  przyciski (compact). Zaplanowane celowo ("op-* classes pruned in favor of variant tokens")
  i zgodne z celem redesignu „compact density".
- **Fix A ⭐**: Zaakceptować — celowy efekt migracji + compact density; paleta zachowana.
- **Fix B**: Przywrócić oryginalne metryki przez nakładkę klas na wybranych CTA (łamie semantykę wariantów).
- **Decision**: ACCEPTED (Fix A) — celowy efekt migracji, kolory zachowane

### F2 — Przycisk „view/hide" w audycie zniknął (zastąpiony klikalnym wierszem)

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — szybka decyzja; afordancja istniała jako tekst w wierszu
- **Dimension**: Pattern Consistency
- **Location**: apps/web/src/app/features/audit/audit.component.html (~:92-110)
- **Detail**: W referencji rozwijanie szczegółów było osobnym `hlmBtn size="sm" variant="ghost"`
  (View/Hide). W zmigrowanej wersji to był goły tekst „view"/„hide" wewnątrz całego klikalnego
  `<tr role="button">`. Afordancja działała, ale wystylizowany przycisk ghost zniknął — jedyne
  miejsce realnego usunięcia przycisku, nie tylko przemapowania.
- **Fix**: Przywrócono `hlmBtn variant="ghost" size="sm"` (view/hide) w kolumnie Detail z
  `(click)="$event.stopPropagation(); store.select(event.id)"`, zachowując klikalny wiersz.
- **Decision**: FIXED — import HlmButton + przycisk ghost w kolumnie detail; lint/build zielone

### F3 — destructive to subtelny tint, dobrze pasuje do starego „delete"

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Pattern Consistency
- **Location**: libs/ui/button/src/lib/hlm-button.ts:32
- **Detail**: `bg-destructive/10 + text-destructive` (nie pełny czerwony). Stare delete było
  obwódkowe (`border-op-danger + text-op-danger-text + bg-op-cream`). Zmiana: obwódka → 10% tła;
  wizualnie bliskie, bez utraty.
- **Decision**: ACKNOWLEDGED — bez akcji

### F4 — stopPropagation na triggerze kebaba tylko w devices

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Safety & Quality
- **Location**: devices.component.html:158 (vs llm-providers / skills)
- **Detail**: Tylko devices ma `(click)="$event.stopPropagation()"` na triggerze kebaba, bo
  tylko jego wiersze są nawigowalne (`appClickable` + `toService`). llm-providers/skills mają
  zwykłe `<tr hlmTr>` bez row-clicku — brak guardu jest poprawny dziś. Uwaga na przyszłość:
  jeśli te tabele staną się row-clickable, trzeba dodać guard.
- **Decision**: ACKNOWLEDGED — poprawne dziś, nota na przyszłość

### F5 — Ostrzeżenie budżetu bundla (732 kB > 500 kB warn)

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Success Criteria
- **Location**: apps/web build output
- **Detail**: Wzrost m.in. przez `@angular/cdk` (dropdown-menu/button-group). Poniżej progu
  błędu 1 MB, build przechodzi. Konfiguracja budżetu (`apps/web/project.json`) niezmieniona.
- **Decision**: ACKNOWLEDGED — warning, nie błąd
