-- Service-only command journal. Never contains PAN/CVC or Stripe secret keys.
create table if not exists public.crm_financial_commands (
 id uuid primary key default gen_random_uuid(), operation_key text unique not null,
 request_hash text not null, quote_id text not null, lead_id text not null,
 kind text not null, provider_account text not null, provider_mode text not null check(provider_mode in ('live','test')),
 actor_id text, state text not null default 'reserved' check(state in ('reserved','provider_pending','provider_returned','complete','failed')),
 provider_hash text, provider_path text, provider_result jsonb, result jsonb,
 lease_token uuid not null, lease_until timestamptz,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index if not exists financial_active_quote on public.crm_financial_commands(quote_id) where state not in ('complete','failed');
alter table public.crm_financial_commands enable row level security;
revoke all on public.crm_financial_commands from public, anon, authenticated;
grant select,insert,update on public.crm_financial_commands to service_role;
create or replace function public.reserve_financial_command(p_key text,p_hash text,p_quote text,p_lead text,p_kind text,p_account text,p_mode text,p_actor text,p_lease uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare q jsonb; op public.crm_financial_commands;
begin
 select data into q from public.crm_quotes where id=p_quote and not deleted for update;
 if q is null or q->>'leadId' is distinct from p_lead then raise exception 'Quote ownership mismatch'; end if;
 select * into op from public.crm_financial_commands where operation_key=p_key for update;
 if found then
  if op.request_hash<>p_hash or op.quote_id<>p_quote or op.lead_id<>p_lead or op.provider_account<>p_account or op.provider_mode<>p_mode then raise exception 'Operation payload mismatch'; end if;
  if op.state='complete' then return to_jsonb(op); end if;
  if op.lease_until>now() then raise exception 'Operation is running'; end if;
  if op.state='failed' then op.state:='reserved'; end if;
  update public.crm_financial_commands set state=op.state,lease_token=p_lease,lease_until=now()+interval '5 minutes' where id=op.id returning * into op;
  return to_jsonb(op);
 end if;
 if exists(select 1 from public.crm_checkout_operations where quote_id=p_quote and state in ('reserved','open','unknown')) then raise exception 'Customer checkout is still open'; end if;
 if exists(select 1 from public.crm_payment_operations where quote_id=p_quote and state not in ('complete','failed')) then raise exception 'Earlier collection is unresolved'; end if;
 if p_kind in ('charge-deposit:','save-payment-method:') and (coalesce((q->>'depositPaidAmount')::numeric,0)>0 or nullif(q->>'depositPaidAt','') is not null) then raise exception 'Deposit already recorded'; end if;
 insert into public.crm_financial_commands(operation_key,request_hash,quote_id,lead_id,kind,provider_account,provider_mode,actor_id,lease_token,lease_until)
 values(p_key,p_hash,p_quote,p_lead,p_kind,p_account,p_mode,p_actor,p_lease,now()+interval '5 minutes') returning * into op;
 return to_jsonb(op);
end $$;
create or replace function public.apply_financial_projection(p_id uuid,p_lease uuid,p_revision integer,p_quote jsonb,p_lead_patch jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare op public.crm_financial_commands; q jsonb; l jsonb; answer jsonb;
begin
 select * into op from public.crm_financial_commands where id=p_id for update;
 if not found or op.lease_token<>p_lease then raise exception 'Command lease mismatch'; end if;
 if op.state='complete' then return jsonb_build_object('quote',op.result->'quote','lead',op.result->'lead'); end if;
 if op.state<>'provider_returned' or op.provider_result->>'id' is null or coalesce(op.provider_result->>'status','') not in ('succeeded','requires_capture','canceled') then raise exception 'No confirmed provider result'; end if;
 select data into q from public.crm_quotes where id=op.quote_id and not deleted for update;
 select data into l from public.crm_leads where id=op.lead_id and not deleted for update;
 if q is null or l is null or q->>'leadId'<>op.lead_id or p_quote->>'id'<>op.quote_id or p_quote->>'leadId'<>op.lead_id then raise exception 'Projection identity mismatch'; end if;
 if coalesce((q->>'revision')::integer,0)<>p_revision then raise exception 'Quote changed after collection; reconciliation required'; end if;
 q := p_quote || jsonb_build_object('revision',p_revision+1);
 l := l || p_lead_patch;
 update public.crm_quotes set data=q,updated_at=now() where id=op.quote_id;
 update public.crm_leads set data=l,updated_at=now() where id=op.lead_id;
 answer := jsonb_build_object('quote',q,'lead',l);
 update public.crm_financial_commands set state='complete',result=answer||jsonb_build_object('ok',true,'balance',q->'balance','amount',coalesce((op.provider_result->>'amount_received')::numeric,0)/100,'depositCharged',op.kind='save-payment-method:','cardBrand',q->'depositStripeCardBrand','cardLast4',q->'depositStripeCardLast4'),lease_until=null,updated_at=now() where id=op.id;
 return answer;
end $$;
revoke all on function public.reserve_financial_command(text,text,text,text,text,text,text,text,uuid) from public,anon,authenticated;
grant execute on function public.reserve_financial_command(text,text,text,text,text,text,text,text,uuid) to service_role;
revoke all on function public.apply_financial_projection(uuid,uuid,integer,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.apply_financial_projection(uuid,uuid,integer,jsonb,jsonb) to service_role;

create or replace function public.reserve_checkout_collection(p_quote_id text,p_lead_id text,p_account text,p_mode text,p_hash text,p_params text,p_expected_revision integer)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare q jsonb; op public.crm_checkout_operations;
begin
 select data into q from public.crm_quotes where id=p_quote_id and not deleted for update;
 if q is null or q->>'leadId' is distinct from p_lead_id then raise exception 'Quote ownership mismatch'; end if;
 if coalesce((q->>'depositPaidAmount')::numeric,0)>0 or nullif(q->>'depositPaidAt','') is not null then raise exception 'Deposit already recorded'; end if;
 if to_regclass('public.crm_financial_commands') is not null and exists(select 1 from public.crm_financial_commands where quote_id=p_quote_id and state not in ('complete','failed')) then raise exception 'A financial command is awaiting reconciliation'; end if;
 if exists(select 1 from public.crm_payment_operations where quote_id=p_quote_id and state not in ('complete','failed')) then raise exception 'A card collection is awaiting reconciliation'; end if;
 select * into op from public.crm_checkout_operations where quote_id=p_quote_id and state in ('reserved','open','unknown') for update;
 if found then
  if op.request_hash<>p_hash or op.provider_account<>p_account or op.provider_mode<>p_mode then raise exception 'A different checkout is already pending'; end if;
  return to_jsonb(op);
 end if;
 if coalesce((q->>'revision')::integer,0)<>p_expected_revision then raise exception 'Quote changed; reload before checkout'; end if;
 insert into public.crm_checkout_operations(quote_id,lead_id,provider_account,provider_mode,request_hash,request_params)
 values(p_quote_id,p_lead_id,p_account,p_mode,p_hash,p_params) returning * into op;
 return to_jsonb(op);
end $$;
revoke all on function public.reserve_checkout_collection(text,text,text,text,text,text,integer) from public,anon,authenticated;
grant execute on function public.reserve_checkout_collection(text,text,text,text,text,text,integer) to service_role;
