-- Dashboard reads must remain bounded as call history grows. The previous RPC
-- expanded, sorted and rebuilt every lead's callLogs JSON array on each refresh,
-- which could monopolize Postgres and make even trivial CRM reads time out.
create or replace function public.crm_sales_overview_leads()
returns table(data jsonb)
language sql
stable
security definer
set search_path = public
as $$
  select lead.data - array[
    'supabaseListing',
    'listingScanSnapshot',
    'inventoryVerification',
    'inventory',
    'removedInventoryItemKeys',
    'mediaAssets',
    'crewHours',
    'crewPayouts',
    'moveExecutionLog',
    'opsChecklist',
    'promises',
    'callLogs'
  ]::text[]
  from public.crm_leads lead
  where lead.deleted = false;
$$;

revoke all on function public.crm_sales_overview_leads() from public;
revoke all on function public.crm_sales_overview_leads() from anon;
revoke all on function public.crm_sales_overview_leads() from authenticated;
grant execute on function public.crm_sales_overview_leads() to service_role;
