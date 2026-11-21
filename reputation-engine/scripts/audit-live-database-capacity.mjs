import fs from 'node:fs'

const adminLine = fs.readFileSync(new URL('../.env.supabase-admin.local', import.meta.url), 'utf8')
  .split('\n').find(line => line.startsWith('SUPABASE_ACCESS_TOKEN='))
const runtimeLine = fs.readFileSync(new URL('../.env.partnership-runtime.local', import.meta.url), 'utf8')
  .split('\n').find(line => line.startsWith('SUPABASE_URL='))
if (!adminLine || !runtimeLine) throw new Error('Missing local Supabase audit configuration')
const unquote = value => value.trim().replace(/^['"]|['"]$/g, '')
const token = unquote(adminLine.slice('SUPABASE_ACCESS_TOKEN='.length))
const project = new URL(unquote(runtimeLine.slice('SUPABASE_URL='.length))).hostname.split('.')[0]
if (!/^[a-z0-9]{20}$/.test(project)) throw new Error('Unexpected Supabase project reference')

const queries = {
  capacity: `select current_setting('max_connections')::int as max_connections,
    (select count(*) from pg_stat_activity where datname=current_database()) as used_connections,
    (select count(*) from pg_stat_activity where datname=current_database() and state='idle in transaction') as idle_in_transaction,
    (select count(*) from pg_stat_activity where datname=current_database() and wait_event_type='Lock') as lock_waiters,
    (select pg_size_pretty(pg_database_size(current_database()))) as database_size`,
  activity: `select coalesce(application_name,'') as application_name, coalesce(state,'') as state,
    coalesce(wait_event_type,'') as wait_type, count(*)::int as sessions
    from pg_stat_activity where datname=current_database()
    group by 1,2,3 order by sessions desc limit 20`,
  hot_queries: `select calls, round(total_exec_time::numeric,0) as total_ms,
    round(mean_exec_time::numeric,1) as mean_ms,
    round(max_exec_time::numeric,1) as max_ms,
    rows, queryid::text as query_id,
    left(regexp_replace(query, $$'([^']|'')*'$$, $$'?'$$, 'g'), 240) as query_shape
    from pg_stat_statements order by total_exec_time desc limit 12`,
  touch_query: `select left(regexp_replace(query, $$'([^']|'')*'$$, $$'?'$$, 'g'), 1100) as query_shape
    from pg_stat_statements where queryid=301111435896678972 limit 1`,
  touch_indexes: `select indexname, indexdef from pg_indexes
    where schemaname='public' and tablename='market_touches' order by indexname`,
  touch_estimate: `select n_live_tup::bigint as estimated_rows, n_dead_tup::bigint as estimated_dead_rows,
    last_autovacuum, last_autoanalyze from pg_stat_user_tables
    where schemaname='public' and relname='market_touches'`,
}

async function readOnlyQuery(query) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${project}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: `begin read only; set local statement_timeout='8s'; ${query}; rollback;` }),
    signal: AbortSignal.timeout(20000),
  })
  if (!response.ok) throw new Error(`Supabase audit query failed: HTTP ${response.status}`)
  const payload = await response.json()
  return Array.isArray(payload) ? payload.filter(row => row && Object.keys(row).length) : payload
}

const report = { checkedAt: new Date().toISOString(), project, sections: {} }
for (const [name, query] of Object.entries(queries)) {
  try { report.sections[name] = await readOnlyQuery(query) }
  catch (error) { report.sections[name] = { error: error.message } }
}
console.log(JSON.stringify(report, null, 2))
