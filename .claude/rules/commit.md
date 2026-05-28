# Commit Messages — Conventional Commits

## Types (release impact)

- `feat` / `fix` / `perf` / `revert` — triggers release
- `docs` / `style` / `refactor` / `test` / `chore` / `ci` / `build` — no release

## Scopes

`web` | `api` | `shared` | `config`

## Rules

- subject 10-100 chars
- breaking change: `feat!:` or footer `BREAKING CHANGE:` → major release

## Example

feat(api): add jwt refresh token mechanism
