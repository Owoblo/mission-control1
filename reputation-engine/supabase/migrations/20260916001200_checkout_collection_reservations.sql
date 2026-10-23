create table if not exists public.crm_checkout_operations (
 id uuid primary key default gen_random_uuid(),quote_id text not null,lead_id text not null,
 provider_account text not null,provider_mode text not null check(provider_mode in ('test','live')),
 request_hash text not null,request_params text not null,
 state text not null default 'reserved' check(state in ('reserved','open','unknown','completed','expired')),
 session_id text,session_url text,created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create unique index if not exists checkout_active_quote on public.crm_checkout_operations(quote_id) where state in ('reserved','open','unknown');
alter table public.crm_checkout_operations enable row level security;
revoke all on public.crm_checkout_operations from anon,authenticated;
grant select,insert,update on public.crm_checkout_operations to service_role;
create or replace function public.reserve_checkout_collection(p_quote_id text,p_lead_id text,p_account text,p_mode text,p_hash text,p_params text,p_expected_revision integer)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare q jsonb; op public.crm_checkout_operations;
begin
 select data into q from public.crm_quotes where id=p_quote_id and not deleted for update;
 if q is null or q->>'leadId' is distinct from p_lead_id then raise exception 'Quote ownership mismatch'; end if;
 if coalesce((q->>'depositPaidAmount')::numeric,0)>0 or nullif(q->>'depositPaidAt','') is not null then raise exception 'Deposit already recorded'; end if;
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
