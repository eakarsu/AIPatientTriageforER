BEGIN;
CREATE TABLE IF NOT EXISTS governed_work_items (
  id BIGSERIAL PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  workflow_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK(status IN('draft','submitted','approved','rejected','retired','erasure_pending','erased')),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
  input JSONB NOT NULL,
  result JSONB NOT NULL,
  assumptions JSONB NOT NULL DEFAULT '[]'::jsonb,
  uncertainty JSONB NOT NULL DEFAULT '{}'::jsonb,
  provenance JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_by TEXT NOT NULL,
  approved_by TEXT,
  approval_note TEXT,
  idempotency_key TEXT NOT NULL,
  request_hash CHAR(64) NOT NULL,
  erasure_idempotency_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id,workflow_type,idempotency_key),
  UNIQUE(tenant_id,id)
);

CREATE TABLE IF NOT EXISTS governed_work_events (
  id BIGSERIAL PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  work_item_id BIGINT NOT NULL,
  actor_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY(tenant_id,work_item_id)
    REFERENCES governed_work_items(tenant_id,id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS governed_integration_outbox (
  id BIGSERIAL PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  work_item_id BIGINT NOT NULL,
  provider TEXT NOT NULL,
  operation TEXT NOT NULL CHECK(operation IN('export','delete','notify','synchronize','execute')),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK(status IN('queued','processing','delivered','failed','dead_letter')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts >= 0),
  last_error TEXT,
  idempotency_key TEXT NOT NULL,
  request_hash CHAR(64) NOT NULL,
  claim_token TEXT,
  lease_expires_at TIMESTAMPTZ,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id,provider,idempotency_key),
  FOREIGN KEY(tenant_id,work_item_id)
    REFERENCES governed_work_items(tenant_id,id) ON DELETE RESTRICT
);

-- These additive clauses make the migration safe for databases that applied an
-- earlier draft of this file before request-body idempotency was introduced.
ALTER TABLE governed_work_items ADD COLUMN IF NOT EXISTS request_hash CHAR(64);
UPDATE governed_work_items SET request_hash=repeat('0',64) WHERE request_hash IS NULL;
ALTER TABLE governed_work_items ALTER COLUMN request_hash SET NOT NULL;
ALTER TABLE governed_work_items ADD COLUMN IF NOT EXISTS erasure_idempotency_key TEXT;
ALTER TABLE governed_integration_outbox ADD COLUMN IF NOT EXISTS request_hash CHAR(64);
UPDATE governed_integration_outbox SET request_hash=repeat('0',64) WHERE request_hash IS NULL;
ALTER TABLE governed_integration_outbox ALTER COLUMN request_hash SET NOT NULL;
ALTER TABLE governed_integration_outbox ADD COLUMN IF NOT EXISTS claim_token TEXT;
ALTER TABLE governed_integration_outbox ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS governed_connector_checkpoints (
  tenant_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  cursor_value TEXT,
  source_version TEXT,
  last_success_at TIMESTAMPTZ,
  last_failure_at TIMESTAMPTZ,
  last_error TEXT,
  records_seen BIGINT NOT NULL DEFAULT 0,
  records_accepted BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(tenant_id,provider),
  CHECK(records_seen >= 0 AND records_accepted >= 0 AND records_accepted <= records_seen)
);

CREATE INDEX IF NOT EXISTS governed_work_scope_idx
  ON governed_work_items(tenant_id,workflow_type,status,updated_at DESC);
CREATE INDEX IF NOT EXISTS governed_events_scope_idx
  ON governed_work_events(tenant_id,work_item_id,created_at);
CREATE INDEX IF NOT EXISTS governed_outbox_ready_idx
  ON governed_integration_outbox(status,next_attempt_at);

CREATE OR REPLACE FUNCTION reject_governed_event_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'governed_work_events is append-only'; END $$;
DROP TRIGGER IF EXISTS governed_work_events_append_only ON governed_work_events;
CREATE TRIGGER governed_work_events_append_only
BEFORE UPDATE OR DELETE ON governed_work_events
FOR EACH ROW EXECUTE FUNCTION reject_governed_event_mutation();
COMMIT;
