# Governed ER triage operations

## Intended use and limits

The governed API supports, but never replaces, emergency clinician judgment. It records unit-bearing observations, evidence-linked triage levels, uncertainty, reassessment, escalation ownership, clinician approval, and reconciled EMS arrival messages. Autonomous disposition is prohibited. Validate under/over-triage, deterioration, missing data, cohorts, and edge cases prospectively.

## Data and integrations

Signed tenant claims, consent, retention, deduplication, and an independent qualified clinician are mandatory. EHR/FHIR, lab, imaging, device, pharmacy, scheduling, payer, and EMS operations use an approval-gated outbox with request-bound idempotency, bounded retry, dead letters, and reconciliation. EMS events remain staged until clinician reconciliation. Credentials never enter workflow payloads.

## Deploy, rollback, and recovery

Run `./start.sh check`, back up PostgreSQL, then use `ALLOW_SCHEMA_MIGRATION=1 ./start.sh migrate`. Roll back code without removing additive audit tables. Restore only a verified backup, reconcile clinical and EMS sources, and never replay a triage decision as an automatic clinical action. Rotate JWT/provider credentials centrally and invalidate old tokens.

Alert immediately on high-acuity escalation failure, stale reassessment, duplicate observation, EMS divergence, self-approval, missing consent, dead letters, and validation threshold regression. Erasure requires delivered provider receipts.
