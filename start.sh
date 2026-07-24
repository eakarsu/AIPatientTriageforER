#!/usr/bin/env bash
set -euo pipefail

# Local demo credential bridge (managed by tools/fix_demo_autofill.mjs)
demo_credentials_project_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
if [ -f "$demo_credentials_project_dir/.env" ]; then
  while IFS= read -r demo_credentials_line || [ -n "$demo_credentials_line" ]; do
    case "$demo_credentials_line" in ''|'#'*) continue ;; esac
    demo_credentials_line="${demo_credentials_line#export }"
    demo_credentials_key="${demo_credentials_line%%=*}"
    demo_credentials_value="${demo_credentials_line#*=}"
    case "$demo_credentials_key" in
      NODE_ENV|ENABLE_DEMO_CREDENTIAL_AUTOFILL|DEMO_EMAIL|DEMO_PASSWORD|SEED_ADMIN_EMAIL|SEED_ADMIN_PASSWORD|ADMIN_EMAIL|ADMIN_PASSWORD|DEFAULT_EMAIL|DEFAULT_PASSWORD) ;;
      *) continue ;;
    esac
    [ -n "${!demo_credentials_key+x}" ] && continue
    demo_credentials_first="${demo_credentials_value:0:1}"
    demo_credentials_last="${demo_credentials_value: -1}"
    if { [ "$demo_credentials_first" = '"' ] && [ "$demo_credentials_last" = '"' ]; } || { [ "$demo_credentials_first" = "'" ] && [ "$demo_credentials_last" = "'" ]; }; then
      demo_credentials_value="${demo_credentials_value:1:${#demo_credentials_value}-2}"
    fi
    export "$demo_credentials_key=$demo_credentials_value"
  done < "$demo_credentials_project_dir/.env"
fi
demo_credentials_email=""
demo_credentials_password=""
if [ -n "${DEMO_EMAIL:-}" ] && [ -n "${DEMO_PASSWORD:-}" ]; then
  demo_credentials_email="$DEMO_EMAIL"
  demo_credentials_password="$DEMO_PASSWORD"
elif [ -n "${SEED_ADMIN_EMAIL:-}" ] && [ -n "${SEED_ADMIN_PASSWORD:-}" ]; then
  demo_credentials_email="$SEED_ADMIN_EMAIL"
  demo_credentials_password="$SEED_ADMIN_PASSWORD"
elif [ -n "${ADMIN_EMAIL:-}" ] && [ -n "${ADMIN_PASSWORD:-}" ]; then
  demo_credentials_email="$ADMIN_EMAIL"
  demo_credentials_password="$ADMIN_PASSWORD"
elif [ -n "${DEFAULT_EMAIL:-}" ] && [ -n "${DEFAULT_PASSWORD:-}" ]; then
  demo_credentials_email="$DEFAULT_EMAIL"
  demo_credentials_password="$DEFAULT_PASSWORD"
fi
if [ "${NODE_ENV:-development}" != production ] && [ "${ENABLE_DEMO_CREDENTIAL_AUTOFILL:-true}" = true ] && [ -n "$demo_credentials_email" ] && [ -n "$demo_credentials_password" ]; then
  export VITE_ENABLE_DEMO_CREDENTIAL_AUTOFILL=true
  export VITE_DEMO_EMAIL="$demo_credentials_email"
  export VITE_DEMO_PASSWORD="$demo_credentials_password"
  export REACT_APP_ENABLE_DEMO_CREDENTIAL_AUTOFILL=true
  export REACT_APP_DEMO_EMAIL="$demo_credentials_email"
  export REACT_APP_DEMO_PASSWORD="$demo_credentials_password"
  export NEXT_PUBLIC_ENABLE_DEMO_CREDENTIAL_AUTOFILL=true
  export NEXT_PUBLIC_DEMO_EMAIL="$demo_credentials_email"
  export NEXT_PUBLIC_DEMO_PASSWORD="$demo_credentials_password"
else
  export VITE_ENABLE_DEMO_CREDENTIAL_AUTOFILL=false
  export REACT_APP_ENABLE_DEMO_CREDENTIAL_AUTOFILL=false
  export NEXT_PUBLIC_ENABLE_DEMO_CREDENTIAL_AUTOFILL=false
  unset VITE_DEMO_EMAIL VITE_DEMO_PASSWORD REACT_APP_DEMO_EMAIL REACT_APP_DEMO_PASSWORD NEXT_PUBLIC_DEMO_EMAIL NEXT_PUBLIC_DEMO_PASSWORD
fi
unset demo_credentials_email demo_credentials_password demo_credentials_project_dir demo_credentials_line demo_credentials_key demo_credentials_value demo_credentials_first demo_credentials_last

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
API_DIR="$PROJECT_DIR/backend"
UI_DIR="$PROJECT_DIR/frontend"
MIGRATION="$API_DIR/migrations/001_governed_workflows.sql"

if [[ ! -f "$PROJECT_DIR/.env" ]]; then
  echo 'Copy .env.example to .env and configure it' >&2
  exit 1
fi
set -a
# shellcheck disable=SC1091
source "$PROJECT_DIR/.env"
set +a

check() {
  command -v node >/dev/null && command -v npm >/dev/null || { echo 'node and npm are required' >&2; return 1; }
  [[ "${JWT_SECRET:-}" =~ ^.{32,}$ ]] || { echo 'JWT_SECRET must contain at least 32 characters' >&2; return 1; }
  [[ "${GOVERNANCE_TENANT_ID:-}" =~ ^[A-Za-z0-9._:-]{3,128}$ ]] || { echo 'GOVERNANCE_TENANT_ID is required' >&2; return 1; }
  for key in DB_HOST DB_PORT DB_NAME DB_USER DB_PASSWORD; do
    [[ -n "${!key:-}" ]] || { echo "$key is required" >&2; return 1; }
  done
  rg -qi 'secret-key-2024|postgres123|changeme' "$PROJECT_DIR/.env" && { echo 'Replace placeholder credentials in .env' >&2; return 1; }
  echo 'Configuration checks passed'
}

migrate() {
  check
  [[ "${ALLOW_SCHEMA_MIGRATION:-false}" == 'true' || "${ALLOW_SCHEMA_MIGRATION:-0}" == '1' ]] || { echo 'Set ALLOW_SCHEMA_MIGRATION=true for the explicit migrate command' >&2; return 1; }
  command -v psql >/dev/null || { echo 'psql is required for migrations' >&2; return 1; }
  PGPASSWORD="$DB_PASSWORD" psql -v ON_ERROR_STOP=1 -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -f "$MIGRATION"
}

start_services() {
  check
  [[ -d "$API_DIR/node_modules" && -d "$UI_DIR/node_modules" ]] || { echo 'Dependencies are missing; install them explicitly in backend and frontend' >&2; return 1; }
  local backend_port="${BACKEND_PORT:-3001}"
  local frontend_port="${FRONTEND_PORT:-3000}"
  for port in "$backend_port" "$frontend_port"; do
    if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
      echo "Port $port is already in use; refusing to terminate another process." >&2
      return 1
    fi
  done
  (cd "$API_DIR" && BACKEND_PORT="$backend_port" npm start) &
  api_pid=$!
  (cd "$UI_DIR" && PORT="$frontend_port" HOST="${FRONTEND_HOST:-127.0.0.1}" BROWSER=none REACT_APP_API_URL="http://127.0.0.1:${backend_port}" npm start) &
  ui_pid=$!
  trap 'kill "$api_pid" "$ui_pid" 2>/dev/null || true' EXIT INT TERM
  wait "$api_pid" "$ui_pid"
}

case "${1:-start}" in
  check) check ;;
  migrate) migrate ;;
  start) start_services ;;
  *) echo 'Usage: ./start.sh {check|migrate|start}' >&2; exit 2 ;;
esac
