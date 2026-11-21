-- Explicit enrollment by mailbox; inventory discovery cannot activate sending.
create table public.partnership_google_routes (
  mailbox text primary key references public.google_mail_connections(email),
  daily_cap integer not null default 5 check(daily_cap>0),
  warmed_since timestamptz not null,
  last_reply_sync timestamptz,
  inventory_verified_at timestamptz not null,
  enabled boolean not null default false
);
create table public.partnership_google_slots (
  action_key text primary key,
  mailbox text not null references public.partnership_google_routes(mailbox),
  local_day date not null,
  contact_id uuid not null references public.market_contacts(id),
  recipient text not null,
  thread_id text,
  last_scanned timestamptz
);
create index partnership_google_daily on public.partnership_google_slots(mailbox,local_day);
create index partnership_google_scan on public.partnership_google_slots(mailbox,last_scanned,action_key) where thread_id is not null;
alter table public.partnership_google_routes enable row level security;
alter table public.partnership_google_slots enable row level security;
revoke all on public.partnership_google_routes,public.partnership_google_slots from public,anon,authenticated;
grant all on public.partnership_google_routes,public.partnership_google_slots to service_role;

create function public.claim_partnership_google_slot(p_mailbox text,p_key text,p_contact uuid,p_recipient text)
returns void language plpgsql set search_path=public,pg_temp as $$
declare route public.partnership_google_routes; today date := (now() at time zone 'America/Toronto')::date;
begin
 select * into strict route from public.partnership_google_routes where mailbox=p_mailbox for update;
 if not route.enabled or route.warmed_since>now()-interval '14 days' or route.last_reply_sync is null
 or route.last_reply_sync<now()-interval '15 minutes' or route.inventory_verified_at<now()-interval '7 days'
 or not exists(select 1 from public.google_mail_connections where email=p_mailbox and status='connected' and campaign_enabled)
 then raise exception 'Mailbox warmup, inventory, connection or reply sync hold'; end if;
 if exists(select 1 from public.partnership_google_slots where action_key=p_key and mailbox=p_mailbox and local_day=today and contact_id=p_contact and recipient=p_recipient and thread_id is null) then return; end if;
 if (select count(*) from public.partnership_google_slots where mailbox=p_mailbox and local_day=today)>=route.daily_cap then raise exception 'Inbox daily capacity reached'; end if;
 insert into public.partnership_google_slots(action_key,mailbox,local_day,contact_id,recipient) values(p_key,p_mailbox,today,p_contact,p_recipient);
end $$;
revoke all on function public.claim_partnership_google_slot(text,text,uuid,text) from public,anon,authenticated;
grant execute on function public.claim_partnership_google_slot(text,text,uuid,text) to service_role;

create function public.record_partnership_google_reply(p_key text,p_message text,p_email text,p_body text,p_at timestamptz,p_event uuid,p_stop boolean)
returns void language plpgsql set search_path=public,pg_temp as $$
declare slot public.partnership_google_slots; inserted integer;
begin
 select * into strict slot from public.partnership_google_slots where action_key=p_key and lower(recipient)=lower(p_email) and thread_id is not null;
 insert into public.market_touches(id,contact_id,channel,direction,created_at,created_by,notes,metadata)
 values(p_event,slot.contact_id,'email','inbound',p_at,'Gmail reply sync',p_body,jsonb_build_object('mailbox',slot.mailbox,'gmail_message_id',p_message,'thread_id',slot.thread_id))
 on conflict(id) do nothing;
 get diagnostics inserted=row_count;
 if inserted=0 then return; end if;
 update public.market_contacts set last_inbound_at=greatest(last_inbound_at,p_at),sequence_paused=true,
 sequence_paused_reason=case when p_stop then 'opt_out' else 'email_reply' end,
 email_unsubscribed_at=case when p_stop then coalesce(email_unsubscribed_at,p_at) else email_unsubscribed_at end
 where id=slot.contact_id;
 update public.sequence_jobs set status='cancelled',error='Paused after inbound email' where contact_id=slot.contact_id and status='pending';
end $$;
revoke all on function public.record_partnership_google_reply(text,text,text,text,timestamptz,uuid,boolean) from public,anon,authenticated;
grant execute on function public.record_partnership_google_reply(text,text,text,text,timestamptz,uuid,boolean) to service_role;
