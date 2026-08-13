create or replace function public.crm_sales_inbox_leads()
returns table(data jsonb)
language sql stable security definer set search_path = public
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'id', lead.id, 'createdAt', lead.data -> 'createdAt',
    'name', lead.data -> 'name', 'stage', lead.data -> 'stage',
    'phone', lead.data -> 'phone', 'email', lead.data -> 'email',
    'inboundId', lead.data -> 'inboundId',
    'mergedIntoLeadId', lead.data -> 'mergedIntoLeadId',
    'branch', lead.data -> 'branch',
    'originAddress', lead.data -> 'originAddress', 'originCity', lead.data -> 'originCity',
    'destAddress', lead.data -> 'destAddress', 'destCity', lead.data -> 'destCity',
    'moveType', lead.data -> 'moveType', 'totalCubicFeet', lead.data -> 'totalCubicFeet',
    'inboxState', lead.data -> 'inboxState',
    'assignedRep', lead.data -> 'assignedRep',
    'assignedRepName', lead.data -> 'assignedRepName',
    'assignedRepUserId', lead.data -> 'assignedRepUserId',
    'callLogs', case
      when jsonb_typeof(lead.data -> 'callLogs') = 'array'
        then jsonb_path_query_array(lead.data -> 'callLogs', '$[last - 4 to last]')
      else '[]'::jsonb
    end
  ))
  from (
    select id, data from public.crm_leads
    where deleted = false
    order by updated_at desc
    limit 300
  ) lead;
$$;
notify pgrst, 'reload schema';
