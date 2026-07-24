#!/usr/bin/env bash
set -euo pipefail

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
