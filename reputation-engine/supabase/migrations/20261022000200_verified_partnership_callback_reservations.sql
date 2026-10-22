-- Unknown inbound partner callers may be called back only on the same
-- partnership line they called, with a recent immutable inbound receipt.
create table if not exists public.partnership_inbound_call_callbacks (
  call_sid text primary key,
  caller_phone text not null,
  partnership_line text not null,
  evidence jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists partnership_inbound_call_callbacks_caller_idx
  on public.partnership_inbound_call_callbacks(caller_phone, partnership_line, created_at desc);

alter table public.partnership_inbound_call_callbacks enable row level security;
revoke all on public.partnership_inbound_call_callbacks from public, anon, authenticated;
grant select, insert on public.partnership_inbound_call_callbacks to service_role;

create or replace function public.reserve_verified_partnership_callback(
  p_call_sid text,
  p_caller_phone text,
  p_partnership_line text
) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare receipt record;
begin
  if coalesce(p_call_sid, '') = '' or p_caller_phone !~ '^\+1[0-9]{10}$' or p_partnership_line !~ '^\+1[0-9]{10}$' then
    return jsonb_build_object('allowed', false, 'reason', 'invalid_callback_identity');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_caller_phone || ':' || p_partnership_line, 0));
  if exists(select 1 from public.partnership_inbound_call_callbacks where call_sid=p_call_sid) then
    return jsonb_build_object('allowed', false, 'reason', 'callback_already_reserved');
  end if;
  if exists(select 1 from public.partnership_inbound_call_callbacks where caller_phone=p_caller_phone and partnership_line=p_partnership_line and created_at>now()-interval '5 minutes') then
    return jsonb_build_object('allowed', false, 'reason', 'callback_recently_attempted');
  end if;

  select id, received_at into receipt
  from public.crm_interactions
  where received_at > now()-interval '7 days'
    and event->>'source'='partnership_call'
    and event->>'channel'='call'
    and event->>'sender'=p_caller_phone
    and event->>'recipient'=p_partnership_line
  order by received_at desc
  limit 1;

  if not found then
    return jsonb_build_object('allowed', false, 'reason', 'no_recent_matching_inbound_call');
  end if;

  insert into public.partnership_inbound_call_callbacks(call_sid, caller_phone, partnership_line, evidence)
  values(p_call_sid, p_caller_phone, p_partnership_line,
    jsonb_build_object('interaction_id', receipt.id, 'received_at', receipt.received_at, 'policy', 'verified-inbound-callback-v1'));
  return jsonb_build_object('allowed', true, 'interaction_id', receipt.id, 'policy', 'verified-inbound-callback-v1');
end $$;

revoke all on function public.reserve_verified_partnership_callback(text,text,text) from public, anon, authenticated;
grant execute on function public.reserve_verified_partnership_callback(text,text,text) to service_role;
