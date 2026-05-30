#!/usr/bin/env bash
set -euo pipefail

# deploys project files to the remote synology nas via ssh config alias.
# usage: ./scripts/deploy.sh [--help]

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
REMOTE_BASE='/volume1/docker/opspilot'
COMPOSE_SRC="${ROOT_DIR}/context/deployment/compose.yaml"

SSH_ALIAS=""

# ─── colors ───────────────────────────────────────────────────────────────────

if [[ -t 1 ]] && [[ "${TERM:-dumb}" != "dumb" ]]; then
  C_RESET=$'\033[0m'
  C_BOLD=$'\033[1m'
  C_DIM=$'\033[2m'
  C_GREEN=$'\033[0;32m'
  C_YELLOW=$'\033[0;33m'
  C_BOLD_RED=$'\033[1;31m'
  C_BOLD_GREEN=$'\033[1;32m'
  C_BOLD_YELLOW=$'\033[1;33m'
  C_BOLD_CYAN=$'\033[1;36m'
else
  C_RESET='' C_BOLD='' C_DIM='' C_GREEN='' C_YELLOW=''
  C_BOLD_RED='' C_BOLD_GREEN='' C_BOLD_YELLOW='' C_BOLD_CYAN=''
fi

# ─── helpers ──────────────────────────────────────────────────────────────────

usage() {
  cat <<'USAGE'
usage: ./scripts/deploy.sh [--help]

deploys project files to the remote synology nas via an ssh config alias.
requires a configured ~/.ssh/config entry for the target host.

what gets deployed:
  - compose.yaml  (always overwritten)

what is never touched:
  - .env on remote (production secrets stay intact)
  - data/ on remote (sqlite + app state stay intact)
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --help|-h) usage; exit 0 ;;
    *) echo "unknown option: $1" >&2; usage >&2; exit 1 ;;
  esac
  shift
done

prompt_ask() {
  local var=$1 label=$2 desc=$3 hint=$4 default=$5
  local _pa_reply=""
  echo ""
  echo "  ${C_BOLD_CYAN}▶ ${label}${C_RESET}"
  [[ -n "$desc" ]] && printf '  %s%b%s\n' "$C_DIM" "${desc}" "$C_RESET"
  [[ -n "$hint" ]] && printf '  %s%b%s\n' "$C_YELLOW" "${hint}" "$C_RESET"
  printf '%s>%s ' "$C_GREEN" "$C_RESET"
  read -re _pa_reply < /dev/tty || _pa_reply=""
  if [[ -z "$_pa_reply" ]]; then
    printf -v "$var" '%s' "$default"
  else
    printf -v "$var" '%s' "$_pa_reply"
  fi
}

confirm() {
  local question=$1
  local input
  printf '\n%s%s%s %s[Y/n]%s ' "$C_BOLD" "$question" "$C_RESET" "$C_DIM" "$C_RESET"
  read -re input < /dev/tty || input="y"
  [[ "${input:-y}" =~ ^[Yy]$ ]]
}

warn() { echo "  ${C_BOLD_YELLOW}WARNING:${C_RESET} $*" >&2; }

# ─── connection ───────────────────────────────────────────────────────────────

test_connection() {
  local alias=$1
  ssh -o ConnectTimeout=10 -o BatchMode=yes "$alias" 'echo ok' > /dev/null 2>&1
}

print_ssh_config_help() {
  local alias=$1
  echo ""
  echo "  ${C_BOLD_RED}✗ could not connect to host '${alias}'.${C_RESET}"
  echo ""
  echo "  make sure you have an entry in ${C_BOLD}~/.ssh/config${C_RESET}, e.g.:"
  echo ""
  echo "  ${C_DIM}Host ${alias}"
  echo "    HostName   <ip-address-or-hostname>"
  echo "    User       <your-dsm-user>"
  echo "    Port       22"
  echo "    IdentityFile ~/.ssh/id_rsa${C_RESET}"
  echo ""
  echo "  once configured, run the script again."
}

# ─── remote dirs ──────────────────────────────────────────────────────────────

ensure_remote_dirs() {
  echo ""
  printf '  %screating directories on server...%s\n' "$C_DIM" "$C_RESET"
  # shellcheck disable=SC2029
  ssh "$SSH_ALIAS" "mkdir -p ${REMOTE_BASE} ${REMOTE_BASE}/data"
  echo "  ${C_BOLD_GREEN}✓${C_RESET} directories ready"
}

# ─── static files ─────────────────────────────────────────────────────────────

copy_static_files() {
  echo ""
  echo "  ${C_BOLD_CYAN}▶ static files${C_RESET}"
  # -O forces the legacy scp protocol; dsm often has the sftp subsystem disabled
  # (ssh exec works, sftp does not), which makes default scp fail with "connection closed".
  scp -O -q "${COMPOSE_SRC}" "${SSH_ALIAS}:${REMOTE_BASE}/compose.yaml"
  echo "    ${C_BOLD_GREEN}✓${C_RESET} compose.yaml"
}

# ─── summary ──────────────────────────────────────────────────────────────────

show_summary() {
  echo ""
  echo "${C_BOLD_CYAN}=== deploy summary ===${C_RESET}"
  echo ""
  printf '  %s%-24s%s = %s\n' "$C_BOLD" "target" "$C_RESET" "${SSH_ALIAS}  (${REMOTE_BASE})"
  echo ""
  printf '  %sstatic files%s\n' "$C_BOLD" "$C_RESET"
  printf '    %s✓%s compose.yaml\n' "$C_BOLD_GREEN" "$C_RESET"
  echo ""
  echo "${C_BOLD_GREEN}✓ deploy completed successfully.${C_RESET}"
  echo "${C_DIM}.env and data/ on remote were not modified — by design.${C_RESET}"
}

# ─── main ─────────────────────────────────────────────────────────────────────

echo ""
echo "${C_BOLD_CYAN}=== deploy — opspilot → synology ===${C_RESET}"
echo "${C_DIM}copies config files to the remote server.${C_RESET}"

# 1. ssh alias
prompt_ask SSH_ALIAS \
  "SSH host alias" \
  "name of the entry in ~/.ssh/config the script will use to connect." \
  "[e.g. synology, nas | default: synology]" \
  "synology"

echo ""
printf '  %stesting connection to '"'"'%s'"'"'...%s\n' "$C_DIM" "$SSH_ALIAS" "$C_RESET"

if ! test_connection "$SSH_ALIAS"; then
  print_ssh_config_help "$SSH_ALIAS"
  exit 1
fi

echo "  ${C_BOLD_GREEN}✓ connection to '${SSH_ALIAS}' ok.${C_RESET}"

# 2. confirm
confirm "proceed with deploy to '${SSH_ALIAS}'?" || { echo "${C_YELLOW}aborted.${C_RESET}"; exit 0; }

# 3. prepare remote dirs
ensure_remote_dirs

# 4. static files
copy_static_files

# 5. summary
show_summary
