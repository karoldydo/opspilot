# Remote Server Access (Synology NAS)

1. When you need to check, read, list, or verify any files or data on the remote server, you **must** use the MCP SSH tools:
   - `mcp__ssh-synology__exec` for regular commands
   - `mcp__ssh-synology__sudo-exec` for commands requiring elevated privileges
2. The project on the remote server lives at `/volume1/docker/opspilot` — always use it as the working directory for project-related remote commands (e.g., `cd /volume1/docker/opspilot && <command>`).
3. Do not use local shell commands to inspect remote server state — always use the SSH tools above.
4. Non-interactive SSH sessions on Synology do not include Docker in PATH (known gotcha — the login shell that has it is not sourced). When running `docker` or `docker compose` commands, always prefix with:
   `export PATH="/volume1/@appstore/ContainerManager/usr/bin:$PATH"`
