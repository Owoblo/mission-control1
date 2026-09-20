# Schema gap report — repo migrations vs live production schema

Generated 2026-09-20 from a read-only comparison of `supabase/migrations/*.sql`
against the live production database (`public` schema, 239 tables).

## Headline numbers

- Live tables: **239**
- Tables with a `CREATE TABLE` in repo migrations: **61** (54 before this change, +7 added here)
- Live tables with **no** `CREATE TABLE` anywhere in the repo: **179**

## What was fixed in this change

Seven tables were `ALTER`ed by repo migrations but never `CREATE`d, so every
fresh database (preview, local, CI) fails on those migrations. Baseline
`CREATE TABLE` files reconstructed from the live schema (read-only) were added
for:

- `app_users`
- `job_outcomes`
- `market_contacts`
- `market_queue`
- `market_signals`
- `market_touches`
- `sequence_jobs`

Each file is timestamped just before the first migration that alters the
table, is `IF NOT EXISTS`-safe, and leaves later migrations' `ADD COLUMN IF
NOT EXISTS` statements as harmless no-ops. Files are marked NOT APPLIED —
they have never been run against production.

## Remaining gap, by domain (179 tables)

### Core CRM — highest risk (16)
`crm_leads`, `crm_clients`, `crm_quotes`, `crm_emails`, `crm_call_sids`,
`crm_followup_logs`, `crm_checkout_operations`, `crm_payment_operations`,
`crm_payment_operation_events`, `crm_provider_webhook_receipts`,
`crm_callback_action_reservations`, `crm_workers`, `inbound_leads`, `deals`,
`deal_stage_history`, `customer_communications`, `customer_segments`,
`customer_segment_assignments`

These are read/written on nearly every request. None can be rebuilt on a
fresh database today.

### Outreach / email / SMS / direct mail (30)
`market_campaigns`, `market_sequences`, `market_mail_batches`,
`market_mail_items`, `market_print_dispatches`, `market_inventory_events`,
`outreach_contacts`, `outreach_daily_stats`, `outreach_events`,
`outreach_playbook_learnings`, `outreach_reply_patterns`, `outreach_sequences`,
`email_campaigns`, `email_campaign_recipients`, `email_campaign_steps`,
`email_deliveries`, `email_events`, `email_logs`, `email_provider_events`,
`email_sender_accounts`, `email_sends`, `email_templates`, `email_alerts`,
`sms_messages`, `mail_batches`, `mail_batch_items`, `mail_templates`,
`mailing_assets`, `mailing_campaigns`, `mailing_sends`, `mailing_templates`,
`campaign_recipients`, `campaigns`

### Property intelligence — commercial / rental / listings (35)
`commercial_import_chunks`, `commercial_pipeline_runs`,
`commercial_postcard_batches`, `commercial_postcard_recipients`,
`commercial_properties`, `commercial_source_records`, `commercial_source_runs`,
`commercial_spaces`, `rental_import_chunks`, `rental_pipeline_runs`,
`rental_postcard_batches`, `rental_postcard_recipients`, `rental_properties`,
`rental_source_records`, `rental_source_runs`, `rental_units`,
`listing_inventory_scans`, `listing_reveals`, `listing_status_history`,
`listings`, `listings1`, `listings2`, `previous_listings`,
`previous_listings_staging`, `current_listings`, `just_listed`, `sold_archive`,
`sold_listings`, `homeowner_lookups`, `local_entities`, `local_entity_keys`,
`local_entity_relationships`, `local_entity_signal_links`,
`local_entity_source_links`, `local_intelligence_events`,
`local_intelligence_links`, `local_intelligence_sightings`,
`local_intelligence_sources`, `movement_signal_items`, `movement_signal_runs`,
`movement_signal_sightings`, `movement_signal_sources`

(`listings1`, `listings2`, `previous_listings_staging` look like staging or
legacy tables — candidates for archival rather than baselining.)

### Court radar (7)
`court_radar_cases`, `court_radar_documents`, `court_radar_events`,
`court_radar_matches`, `court_radar_parties`, `court_radar_properties`,
`court_radar_requests`

### Procurement (5)
`procurement_assessments`, `procurement_documents`, `procurement_opportunities`,
`procurement_readiness_items`, `procurement_requirements`

### Partner platform (6)
`partner_listing_activity`, `partner_listing_research`,
`partnership_account_policy`, `partnership_action_reservations`,
`partnership_daily_briefs`, `partnership_policy_events`,
`partnership_reviewed_handoffs`

### Billing / wallets / subscriptions (13)
`billing_history`, `company_subscriptions`, `coupons`, `credit_transactions`,
`credits_ledger`, `payments`, `prices`, `pricing_rules`, `products`,
`subscription_tiers`, `subscriptions`, `wallet_transactions`, `wallets`

### City / coverage data (9)
`cities`, `city_lane_coverage`, `city_photo_coverage`, `city_populations`,
`coverage_zones`, `location_cities`, `location_states`, `user_cities`,
`user_location_preferences`

### Saturn platform (4)
`saturn_ai_decisions`, `saturn_ai_incidents`, `saturn_config`,
`saturn_policy_registry`

### Everything else (54)
`activation_cases`, `activation_routes`, `affiliate_submissions`,
`ai_scan_logs`, `analytics_events`, `companies`, `contact_submissions`,
`counterparty_observations`, `counterparty_profiles`,
`counterparty_relationship_actions`, `customers`, `design_orders`,
`design_products`, `feedback`, `furniture_search_cache`,
`intelligence_quality_issues`, `intelligence_source_registry`,
`intelligence_source_runs`, `job_costs`, `mailing_templates` (see outreach),
`moving_companies`, `moving_estimates`, `notifications`, `onboarding_progress`,
`pipeline_assessments`, `pipeline_stages`, `postcard_print_claims`, `profiles`,
`projects`, `quotes`, `relationship_touchpoints`, `review_jobs`,
`review_partners`, `runs`, `saved_searches`, `scrape_logs`, `search_history`,
`support_messages`, `user_preferences`, `user_profiles`, `user_roles`,
`verification_codes`

## Known foreign-key gaps (affect even the 7 new baselines)

These FKs exist live but reference tables with no repo baseline, so a fresh
database still cannot fully satisfy them:

- `market_contacts.batch_id` → `market_campaigns(id)` (no repo coverage at all)
- `sequence_jobs.batch_id` → `market_campaigns(id)` (no repo coverage at all)
- `market_contacts.source_signal_id` → `market_signals(id)` — covered (same baseline file)
- `app_users.partner_id` → `subcontractors(id)` — added by 20260811120000, which itself needs `subcontractors` to exist (it has a repo CREATE)

## Recommendation: stop hand-writing tables

Do **not** hand-write the remaining ~179 tables. The 7 added here were the
minimum needed to unblock the existing migration chain; hand-writing the rest
invites transcription drift.

Recommended baseline strategy:

1. **Schema-only dump from production** (read replica if available):
   `pg_dump --schema-only` the `public` schema. This is the only reliable
   source of truth — the repo history was never it.
2. **Review pass** on the dump: strip any data/ownership statements, confirm
   no sensitive defaults, normalize formatting, and decide the fate of
   obvious staging tables (`listings1`, `listings2`,
   `previous_listings_staging`).
3. **Commit as one timestamped baseline migration** ordered before all
   existing migrations, or as a clearly-marked repair migration — then verify
   with `supabase db reset` (or equivalent) that a fresh database builds
   cleanly end-to-end.
4. **Going forward**: every schema change goes through a repo migration
   (consider `supabase db diff` in the development workflow so the repo stays
   the source of truth), and dashboard DDL becomes the exception, not the
   rule.

Until that happens, treat the migration history as **not sufficient to
rebuild the database** — preview environments and disaster recovery both
depend on the live database's undocumented state.
