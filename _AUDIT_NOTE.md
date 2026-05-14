# Audit Apply Note — AIPatientTriageforER

Source: `_AUDIT/reports/batch_06.md` section 12.

## Original Recommendations
### Missing AI counterparts
- `/patient-history-summarize`
- `/staffing-optimize`
- `/readmission-risk`

### Missing non-AI
- EHR (Epic, Cerner) integration; real-time vitals streaming; ambulance/EMS integration; multi-hospital coordination

### Custom suggestions
- Agentic ER flow optimization; multi-modal symptom assessment; prediction+action bundling; sepsis early warning; discharge risk stratification

## Implemented
Added three endpoints in `backend/routes/ai.js`:
- `POST /api/ai/patient-history-summarize`
- `POST /api/ai/staffing-optimize`
- `POST /api/ai/readmission-risk`

Reused `callOpenRouter`, `parseAIJson`, `persistAiResult`, `auth`, `aiRateLimiter`, Sequelize models.

## Backlog
| Item | Tag |
|---|---|
| EHR (Epic/Cerner) integration | NEEDS-CREDS |
| Real-time vitals stream / WebSocket | NEEDS-PRODUCT-DECISION |
| Ambulance/EMS arrival API | NEEDS-CREDS |
| Multi-hospital bed-availability coordination | NEEDS-CREDS |
| Sepsis early warning ensemble | NEEDS-PRODUCT-DECISION |
| Multi-modal symptom assessment (audio+video) | NEEDS-PRODUCT-DECISION |

## Apply pass 3 (frontend)

- **Action:** LEFT-AS-IS (FE already wired)
- **Why:** `frontend/src/pages/AIPredictivePage.js` already provides a tabbed UI for all three pass-2 endpoints (`/ai/patient-history-summarize`, `/ai/staffing-optimize`, `/ai/readmission-risk`) via the project's `services/api.js` axios wrapper (JWT bearer from `localStorage.token`). Routed in `App.js` at `/ai-predictive` and listed in `components/Layout.js` nav. Idempotence rule applied.

## Apply pass 4 (mechanical backlog)

- **Action:** SKIPPED
- **Why:** All remaining backlog items are tagged `NEEDS-CREDS` (EHR Epic/Cerner, ambulance/EMS, multi-hospital coordination) or `NEEDS-PRODUCT-DECISION` (real-time vitals stream, sepsis ensemble, multi-modal symptom assessment). No mechanical text-only AI counterparts remain.
