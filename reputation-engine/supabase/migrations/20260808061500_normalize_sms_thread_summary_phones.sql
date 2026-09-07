create or replace function public.list_sms_thread_summaries()
returns table (
  contact_phone text,
  business_number text,
  last_message text,
  last_at timestamptz,
  last_direction text,
  latest_lead_id text,
  last_inbound_at timestamptz,
  last_outbound_at timestamptz,
  inbound_times timestamptz[]
)
language sql
stable
security definer
set search_path = public
as $$
  with raw_messages as (
    select
      regexp_replace(coalesce(case when direction = 'inbound' then from_number else to_number end, ''), '[^0-9]', '', 'g') as contact_digits,
      regexp_replace(coalesce(case when direction = 'inbound' then to_number else from_number end, ''), '[^0-9]', '', 'g') as business_digits,
      body,
      created_at,
      direction,
      lead_id,
      twilio_sid
    from public.sms_messages
    where coalesce(case when direction = 'inbound' then from_number else to_number end, '') <> ''
      and coalesce(twilio_sid, '') not like 'HC_SMS_%'
      and lower(coalesce(body, '')) not like '%lead flow health sms probe%'
  ),
  normalized as (
    select
      case when length(contact_digits) >= 10 then '+1' || right(contact_digits, 10) else contact_digits end as contact_phone,
      case when length(business_digits) >= 10 then '+1' || right(business_digits, 10) else business_digits end as business_number,
      body,
      created_at,
      direction,
      lead_id
    from raw_messages
    where length(contact_digits) >= 7
  )
  select
    contact_phone,
    (array_agg(business_number order by created_at desc))[1] as business_number,
    (array_agg(body order by created_at desc))[1] as last_message,
    max(created_at) as last_at,
    (array_agg(direction order by created_at desc))[1] as last_direction,
    (array_agg(lead_id order by created_at desc) filter (where lead_id is not null))[1] as latest_lead_id,
    max(created_at) filter (where direction = 'inbound') as last_inbound_at,
    max(created_at) filter (where direction = 'outbound') as last_outbound_at,
    coalesce(array_agg(created_at order by created_at) filter (where direction = 'inbound'), '{}'::timestamptz[]) as inbound_times
  from normalized
  group by contact_phone
  order by max(created_at) desc;
$$;

revoke all on function public.list_sms_thread_summaries() from public, anon, authenticated;
grant execute on function public.list_sms_thread_summaries() to service_role;
