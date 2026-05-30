---
name: op-commit
description: >-
  Prepare a Conventional Commits message and create the commit (git add -A + git commit) for OpsPilot -
  nothing else, never pushes. Use this whenever the user wants to commit work-in-progress: "op-commit",
  "zacommituj", "zrób commit", "commit these changes", "prepare a commit message", "stwórz commit".
  Reads .claude/rules/commit.md as the source of truth for types/scopes/limits, then stages everything
  and commits in one shot. Prefer this over an ad-hoc git commit so the message stays Conventional-Commits
  compliant. Do NOT use for pushing, branching, tagging, or rebasing.
disable-model-invocation: true
---

# op-commit

A narrow, predictable commit flow for OpsPilot: **stage everything → build a Conventional Commits message → run the commit**. This skill deliberately does nothing more - it **never pushes**, and it does not create branches or tags. Pushing is a separate, deliberate decision the user makes.

## Source of truth

Commit rules live in `.claude/rules/commit.md` - **read that file first** and apply it literally. The summary below is only a fallback in case the file is unavailable:

- **Types (release):** `feat` `fix` `perf` `revert`. **Types (no-release):** `docs` `style` `refactor` `test` `chore` `ci` `build`.
- **Scope:** `web` | `api` | `shared` | `config` (scope is optional).
- **Subject:** 10–100 chars, imperative mood, lowercase after `:`.
- **Breaking change:** `feat!:` or a `BREAKING CHANGE:` footer.

## Flow

### 1. Inspect state

Run in parallel:

- `git status --short` - what is modified/new/deleted.
- `git diff` and `git diff --staged` - the change content you build the message from.
- `git log -5 --oneline` - to match the repo's style.

If the working tree is clean, say so plainly and stop - there is nothing to commit.

### 2. Stage everything

Run `git add -A` - the commit covers **all** changes: modified, new, and deleted files. This is a deliberate, simple "commit the whole current state" policy. If the changes clearly contain something that should not be committed (e.g. secrets, temp files, `.env`), flag it to the user before committing.

### 3. Pick type and scope

Choose the **type** by the nature of the change (new feature → `feat`, fix → `fix`, docs → `docs`, config/chores → `chore`, etc.).

Derive the **scope** from the file paths (current project state - list to be extended later):

| Path                                                                | Scope    |
|---------------------------------------------------------------------|----------|
| `apps/web/**`                                                       | `web`    |
| `apps/api/**`                                                       | `api`    |
| `libs/shared/**`                                                    | `shared` |
| root config, `docker/`, `scripts/`, `context/`, `docs/`, `.claude/` | `config` |

When changes span multiple areas, pick the scope covering the dominant part of the change; if none fits, omit the scope (`type: subject`).

### 4. Build the message

- Header: `type(scope): subject` - subject 10–100 chars, imperative mood, lowercase after `:` (e.g. `add`, not `Added`/`Adds`).
- Body (optional): for larger changes add a short "what and why" bullet list. Skip it for trivial changes.
- Breaking change: `feat!:`/`fix!:` in the header, or a `BREAKING CHANGE: <description>` footer.
- Do not add a `Co-Authored-By` trailer - the repo history does not use it.
- Use LF line endings (the repo enforces `eol=lf` via `.gitattributes`).

**Examples:**

Input: added JWT token refresh in apps/api
Output: `feat(api): add jwt refresh token mechanism`

Input: fix a typo in the README
Output: `docs: fix typo in readme quickstart`

Input: API contract change removing an old field
Output: `feat(api)!: drop legacy userId field from auth response`

### 5. Run the commit

Commit with a multi-line message via repeated `-m` (portable on PowerShell, avoids quoting issues):

```
git commit -m "type(scope): subject" -m "- body point" -m "- another point"
```

**Never run `git push`.**

### 6. Handle the pre-commit hook

The repo has husky + lint-staged (`eslint --fix`, `nx format:write`), which may **modify files during the commit**:

- If the commit went through but the hook reformatted files and left unstaged changes → tell the user; if needed, run `git add -A` and `git commit --amend --no-edit` to fold the formatting fixes into the same commit.
- If the hook **fails** (e.g. eslint did not pass) → show the output and **stop without committing**; do not bypass the hook (`--no-verify`) unless the user explicitly asks.

### 7. Summarize

Show `git log -1 --oneline` and **remind the user that nothing was pushed** - pushing is a separate, deliberate decision.
