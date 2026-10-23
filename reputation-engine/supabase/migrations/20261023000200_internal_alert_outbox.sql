create table if not exists public.crm_alert_outbox (
 id text primary key, event_key text not null, payload jsonb not null,
 state text not null default 'pending' check(state in ('pending','sending','accepted','unknown','failed')),
 attempts integer not null default 0, available_at timestamptz not null default now(),
 provider_message_id text, last_error text, created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create index if not exists alert_outbox_ready on public.crm_alert_outbox(available_at) where state='pending';
alter table public.crm_alert_outbox enable row level security;
revoke all on public.crm_alert_outbox from public,anon,authenticated;
grant select,insert,update on public.crm_alert_outbox to service_role;
create or replace function public.enqueue_internal_alert(p_event text,p_payload jsonb)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare recipient text;
begin
 for recipient in select jsonb_array_elements_text(p_payload->'recipients') loop
  insert into public.crm_alert_outbox(id,event_key,payload) values(p_event||':'||md5(lower(recipient)),p_event,(p_payload-'recipients')||jsonb_build_object('to',recipient)) on conflict do nothing;
 end loop;
end $$;
create or replace function public.save_scope_reviews_with_alert(p_lead text,p_updated timestamptz,p_reviews jsonb,p_event text,p_payload jsonb)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
begin
 update public.crm_leads set data=jsonb_set(data,'{contractorScopeReviews}',p_reviews),updated_at=greatest(clock_timestamp(),updated_at+interval '1 microsecond') where id=p_lead and not deleted and updated_at=p_updated;
 if not found then raise exception 'The job changed. Refresh and try again.'; end if;
 perform public.enqueue_internal_alert(p_event,p_payload);
 return true;
end $$;
create or replace function public.claim_internal_alerts(p_limit integer)
returns setof public.crm_alert_outbox language plpgsql security definer set search_path=public,pg_temp as $$
begin
 -- A crashed/uncertain send must be reconciled, never blindly replayed.
 update public.crm_alert_outbox set state='unknown',last_error='Worker ended before provider outcome was recorded',updated_at=now() where state='sending' and updated_at<now()-interval '5 minutes';
 return query update public.crm_alert_outbox set state='sending',attempts=attempts+1,updated_at=now() where id in (select id from public.crm_alert_outbox where state='pending' and available_at<=now() order by available_at limit least(greatest(p_limit,1),20) for update skip locked) returning *;
end $$;
revoke all on function public.enqueue_internal_alert(text,jsonb) from public,anon,authenticated;
revoke all on function public.save_scope_reviews_with_alert(text,timestamptz,jsonb,text,jsonb) from public,anon,authenticated;
revoke all on function public.claim_internal_alerts(integer) from public,anon,authenticated;
grant execute on function public.enqueue_internal_alert(text,jsonb) to service_role;
grant execute on function public.save_scope_reviews_with_alert(text,timestamptz,jsonb,text,jsonb) to service_role;
grant execute on function public.claim_internal_alerts(integer) to service_role;
