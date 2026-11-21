-- Run in this project's Supabase SQL editor during a CRM outage.
-- Read-only: does not restart services, cancel sessions, or modify records.
BEGIN READ ONLY;
SET LOCAL statement_timeout = '8s';
SET LOCAL lock_timeout = '2s';

SELECT now() AS checked_at, pg_postmaster_start_time() AS database_started_at,
       pg_is_in_recovery() AS in_recovery,
       current_setting('max_connections') AS max_connections;

-- Active work, idle transactions, and connection pressure by application/role.
SELECT usename, application_name, state, wait_event_type, wait_event,
       count(*) AS connections,
       max(now() - xact_start) AS oldest_transaction,
       max(now() - query_start) FILTER (WHERE state = 'active') AS oldest_active_query
FROM pg_stat_activity
WHERE datname = current_database()
GROUP BY usename, application_name, state, wait_event_type, wait_event
ORDER BY connections DESC;

-- Blocked sessions without exposing query text or customer data.
SELECT pid, usename, application_name, state, wait_event_type, wait_event,
       now() - query_start AS query_age,
       pg_blocking_pids(pid) AS blocking_pids
FROM pg_stat_activity
WHERE datname = current_database()
  AND cardinality(pg_blocking_pids(pid)) > 0
ORDER BY query_start;

-- Cumulative counters; compare snapshots to identify a current increase.
SELECT numbackends, deadlocks, temp_files, temp_bytes, stats_reset
FROM pg_stat_database
WHERE datname = current_database();

-- Estimates avoid expensive full-table counts during an outage.
SELECT relname, n_live_tup AS estimated_rows, n_dead_tup AS estimated_dead_rows,
       last_autovacuum, last_autoanalyze
FROM pg_stat_user_tables
WHERE schemaname = 'public'
  AND relname IN ('market_contacts', 'market_touches', 'crm_leads',
                  'crm_automation_jobs', 'sms_messages')
ORDER BY relname;

-- Minimal CRM read: success here while REST hangs narrows the fault to API access.
SELECT EXISTS (SELECT 1 FROM public.market_contacts LIMIT 1) AS partnership_records_present,
       EXISTS (SELECT 1 FROM public.crm_leads LIMIT 1) AS sales_records_present;

ROLLBACK;
