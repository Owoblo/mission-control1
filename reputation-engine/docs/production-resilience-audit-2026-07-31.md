# Production resilience audit — 2026-07-31

## Executive finding

The CRM incident was caused by a genuine Supabase database connectivity failure. During the incident, the project-level API still described the project as active while the detailed health endpoints reported the database, REST API, and Auth as unhealthy with `Failed to connect to database`. A project restart was attempted; service briefly recovered, then returned SSL 525/unhealthy responses, and later recovered fully.

The application made the outage more disruptive and confusing than necessary:

- The sales overview is an all-or-nothing aggregation. One failed data source rejects the entire response.
- The overview read fetched the complete follow-up history twice.
- The browser replaced unavailable CRM data with empty arrays and rendered convincing zero metrics.
- An outbound message could be accepted by Twilio/Resend, then reported as failed because later CRM bookkeeping timed out. This creates a duplicate-send risk when a rep retries.
- The scheduled lead-flow health check used `GET`, while alert email was only implemented for `POST`. The scheduled check therefore did not alert.
- The server's ten-second stale overview cache is process-local and is not dependable across Vercel cold starts or multiple function instances.

## Current production state

- `go.quote2move.com` resolves to and is served by Vercel. Cloudflare is not in the dashboard request path.
- The active Vercel deployment is ready and the production alias is attached.
- Supabase database, REST, Auth, and Storage health checks recovered to healthy during this audit.
- Realtime reported a healthy service process but no connected database/replication cluster. This may reflect no active subscriber, but should be checked if live updates are expected.
- A direct Supabase REST request and the public application endpoints responded quickly after recovery.
- The supplied Cloudflare API token was rejected as invalid. Supabase and Vercel management access succeeded.

## Database observations

- Database size: approximately 1.41 GiB.
- Connection limit: 60; observed connections: 31, with two active. The apparent waiting connections were idle `ClientRead` sessions, not blocked queries.
- No long-running or blocking query was observed after recovery.
- Largest relations included `analytics_events` (~602 MiB), `listings` (~415 MiB), `just_listed` (~98 MiB), and `sold_listings` (~95 MiB).
- `crm_leads` was ~12 MiB for roughly 918 live rows. The large JSON payload makes repeated unbounded overview reads expensive.
- PostgreSQL table statistics contained material estimate/live-count discrepancies for `analytics_events` and `crm_followup_logs`, suggesting stale statistics or heavy churn. Run `ANALYZE` during a controlled maintenance window and review retention for analytics/listing datasets.
- `crm_leads` had high sequential-scan activity relative to its narrow index set. JSONB-wide reads and JSON-path filters should be profiled before adding indexes blindly.

## Changes made locally

1. Preserve the last successful dashboard snapshot in browser session storage. During a live-data failure, the UI now shows an amber stale-data warning and the snapshot time instead of false zeros.
2. After a provider accepts an SMS/email, CRM persistence runs concurrently with an eight-second bound. Persistence failures are returned as warnings and no longer turn an accepted delivery into an apparent send failure.
3. Reuse the overview's follow-up-log promise for lifecycle filtering, eliminating one complete duplicate follow-up-history read.
4. Make the cron-compatible `GET /api/ops/lead-flow-health` send an alert email when the report is `fail`.

These changes are local and have not been deployed.

## Remaining high-priority work

1. Separate the incident fixes from the currently mixed worktree, review, and deploy through a traceable Git commit/PR. The active production deployment was not clearly tied to a source commit in the deployment metadata inspected.
2. Add an external uptime monitor for a lightweight authenticated database-readiness endpoint. It must not depend on Supabase to remember alert state, because Supabase is the dependency being monitored.
3. Replace the overview's process-local cache with a shared last-known-good snapshot (for example a small durable cache independent of the primary database) and explicitly label its age.
4. Decompose the overview response so leads, quotes, clients, follow-ups, and telephony can fail independently. Return per-section freshness/error metadata.
5. Paginate or project the dashboard queries. Do not transfer every JSONB lead, quote, and follow-up record on each refresh.
6. Add a durable post-delivery outbox/reconciliation job. The new warning behavior prevents duplicate sends, but a temporary database failure can still leave accepted provider messages absent from CRM history until reconciled.
7. Configure Supabase platform alerts/support escalation and verify backup/PITR coverage appropriate to the business.
8. Investigate the two existing failing authorization tests for branch phone-line isolation before the next release.

## Incident runbook

When the CRM reports unavailable data:

1. Do not interpret dashboard zeros as business zeros. Check whether the banner says the data is stale or unavailable.
2. Check detailed Supabase service health for database and REST, not only the top-level project state.
3. Verify a minimal authenticated REST read with a strict timeout.
4. Check database connection usage, blockers, and long-running queries.
5. If the database service is unhealthy and no application query is blocking it, restart once. If it becomes unhealthy again, open a Supabase support incident rather than repeatedly restarting.
6. Confirm Twilio/Resend provider acceptance before retrying any customer message. A browser timeout is not proof that delivery failed.
7. After recovery, reconcile provider delivery logs against CRM message/follow-up records for the outage window.

## Credential handling

The Cloudflare, Supabase, and Vercel credentials posted in chat must all be revoked and replaced. Do not place replacement credentials in source files or chat. Store them only in the relevant encrypted deployment environment and a password/secrets manager.
