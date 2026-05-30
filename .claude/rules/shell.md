# Shell Usage (Windows + Git Bash)

1. The `Bash` tool runs **POSIX bash from Git Bash / MSYS2** (`/usr/bin/bash`,
   `MINGW64`, bash 5.2) - **not** PowerShell, despite the environment header
   saying "Shell: PowerShell". Always write POSIX syntax in the `Bash` tool:
   `echo`, `&&`, `|`, `$VAR`, redirects `>` / `2>&1`, `/dev/null`.
2. **Never** use PowerShell cmdlets or syntax inside the `Bash` tool -
   `Out-String`, `Write-Output`, `Get-*`, `Select-Object`, `$env:VAR`, `$null`.
   They fail with `command not found` (exit 127).
3. PowerShell is the user's **interactive host shell**, reached only via an
   inline `! <command>`. When a command genuinely needs PowerShell or is
   interactive (e.g. a login flow), tell the user to run it with the `!` prefix
   instead of forcing it through the `Bash` tool.
4. If you must run PowerShell from within the `Bash` tool, invoke it explicitly:
   `powershell -NoProfile -Command "<cmd>"`. Default to POSIX; reach for this
   only for commands needing cmdlets, the Windows registry, COM, or an
   interactive host shell.
5. Use forward slashes in paths; absolute Windows paths work in the `Bash` tool
   (`c:/path/to/project/...`). Avoid `cd` inside compound commands - prefer
   absolute paths.

## Parallel command discipline

1. Do **not** fan out many `Bash` calls at once to inspect state. If one call in
   a parallel batch errors, the harness **cancels its siblings**
   (`Cancelled: parallel tool call … errored`) - those are not independent
   failures, just fallout from the one that broke.
2. After a mutating command (commit, write, move), confirm with **one** simple
   read-only command (e.g. `git log -1 --oneline`), not a battery of variants.
3. Empty output is **not** proof of failure - do not escalate with more parallel
   probes; re-check with a single portable command.

For example: in the `Bash` tool write `git log -1 --pretty=format:'%h %s'`,
not `git log -1 | Out-String`.
