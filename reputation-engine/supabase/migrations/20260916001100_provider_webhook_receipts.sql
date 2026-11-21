create table if not exists public.crm_provider_webhook_receipts (
 provider_account text not null,
 provider_mode text not null check(provider_mode in ('test','live')),
 event_id text not null,
 event_type text not null,
 object_id text not null,
 state text not null default 'processing' check(state in ('processing','retry','complete')),
 lease_token uuid not null default gen_random_uuid(),
 lease_until timestamptz not null default now()+interval '5 minutes',
 received_at timestamptz not null default now(),
 completed_at timestamptz,
 attempts integer not null default 1,
 primary key(provider_account,provider_mode,event_id)
);
alter table public.crm_provider_webhook_receipts enable row level security;
revoke all on public.crm_provider_webhook_receipts from anon,authenticated;
grant select,insert,update on public.crm_provider_webhook_receipts to service_role;
create or replace function public.claim_provider_webhook(p_account text,p_mode text,p_event_id text,p_event_type text,p_object_id text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.crm_provider_webhook_receipts; inserted boolean;
begin
 insert into public.crm_provider_webhook_receipts(provider_account,provider_mode,event_id,event_type,object_id)
 values(p_account,p_mode,p_event_id,p_event_type,p_object_id) on conflict do nothing returning * into r;
 inserted:=found;
 if inserted then return jsonb_build_object('claimed',true,'lease',r.lease_token); end if;
 select * into r from public.crm_provider_webhook_receipts where provider_account=p_account and provider_mode=p_mode and event_id=p_event_id for update;
 if r.event_type<>p_event_type or r.object_id<>p_object_id then raise exception 'Webhook identity conflict'; end if;
 if r.state='complete' then return jsonb_build_object('claimed',false,'complete',true); end if;
 if r.state='processing' and r.lease_until>now() then return jsonb_build_object('claimed',false,'complete',false); end if;
 update public.crm_provider_webhook_receipts set state='processing',lease_token=gen_random_uuid(),lease_until=now()+interval '5 minutes',attempts=attempts+1
 where provider_account=p_account and provider_mode=p_mode and event_id=p_event_id returning * into r;
 return jsonb_build_object('claimed',true,'lease',r.lease_token);
end $$;
revoke all on function public.claim_provider_webhook(text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.claim_provider_webhook(text,text,text,text,text) to service_role;
