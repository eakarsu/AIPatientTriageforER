#!/usr/bin/env bash
set -euo pipefail
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
API_DIR="$PROJECT_DIR/backend"
UI_DIR="$PROJECT_DIR/frontend"
MIGRATION="$API_DIR/migrations/001_governed_workflows.sql"
value() { local key="$1" current="${!1:-}"; if [[ -n "$current" ]]; then printf '%s' "$current"; else awk -F= -v key="$key" '$1==key {sub(/^[^=]*=/, ""); gsub(/^['\"']|['\"']$/, ""); print; exit}' "$PROJECT_DIR/.env"; fi; }
check() { command -v node >/dev/null && command -v npm >/dev/null || { echo 'node and npm are required' >&2; return 1; }; [[ -f "$PROJECT_DIR/.env" ]] || { echo 'Copy .env.example to .env and configure it' >&2; return 1; }; [[ "$(value JWT_SECRET)" =~ ^.{32,}$ ]] || { echo 'JWT_SECRET must contain at least 32 characters' >&2; return 1; }; [[ "$(value GOVERNANCE_TENANT_ID)" =~ ^[A-Za-z0-9._:-]{3,128}$ ]] || { echo 'GOVERNANCE_TENANT_ID is required' >&2; return 1; }; for key in DB_HOST DB_PORT DB_NAME DB_USER DB_PASSWORD; do [[ -n "$(value "$key")" ]] || { echo "$key is required" >&2; return 1; }; done; rg -qi 'secret-key-2024|postgres123|changeme' "$PROJECT_DIR/.env" && { echo 'Replace placeholder credentials in .env' >&2; return 1; }; echo 'Configuration checks passed'; }
migrate() { check; [[ "${ALLOW_SCHEMA_MIGRATION:-$(value ALLOW_SCHEMA_MIGRATION)}" == '1' ]] || { echo 'Set ALLOW_SCHEMA_MIGRATION=1 for the explicit migrate command' >&2; return 1; }; command -v psql >/dev/null || { echo 'psql is required for migrations' >&2; return 1; }; PGPASSWORD="$(value DB_PASSWORD)" psql -v ON_ERROR_STOP=1 -h "$(value DB_HOST)" -p "$(value DB_PORT)" -U "$(value DB_USER)" -d "$(value DB_NAME)" -f "$MIGRATION"; }
start_services() { check; [[ -d "$API_DIR/node_modules" && -d "$UI_DIR/node_modules" ]] || { echo 'Dependencies are missing; install them explicitly in backend and frontend' >&2; return 1; }; (cd "$API_DIR" && npm start) & api_pid=$!; (cd "$UI_DIR" && npm start) & ui_pid=$!; trap 'kill "$api_pid" "$ui_pid" 2>/dev/null || true' EXIT INT TERM; wait "$api_pid" "$ui_pid"; }
case "${1:-check}" in check) check ;; migrate) migrate ;; start) start_services ;; *) echo 'Usage: ./start.sh {check|migrate|start}' >&2; exit 2 ;; esac
