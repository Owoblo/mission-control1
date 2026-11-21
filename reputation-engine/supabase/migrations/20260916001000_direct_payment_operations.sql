-- Additive safety boundary for saved-card deposit/balance collection.
-- Apply before deploying callers. No existing CRM records are backfilled or rewritten.
create table if not exists public.crm_payment_operations (
 id uuid primary key default gen_random_uuid(),
 operation_key text not null,
 provider_account text not null check(provider_account in ('saturn','dexa')),
 provider_mode text not null check(provider_mode in ('test','live')),
 request_hash text not null,
 quote_id text not null,
 lead_id text not null,
 kind text not null check(kind in ('deposit','balance')),
 amount_minor bigint not null check(amount_minor > 0),
 currency text not null check(currency = 'cad'),
 state text not null default 'reserved' check(state in ('reserved','unknown','provider_succeeded','complete','failed')),
 provider_intent_id text,
 provider_status text,
 actor_id text,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(provider_account,provider_mode,operation_key),
 unique(provider_account,provider_mode,provider_intent_id)
);
create index if not exists crm_payment_operations_quote on public.crm_payment_operations(quote_id,state);
create table if not exists public.crm_payment_operation_events (
 id uuid primary key default gen_random_uuid(),
 operation_id uuid not null references public.crm_payment_operations(id),
 event_type text not null,
 occurred_at timestamptz not null default now(),
 details jsonb not null default '{}'
);
alter table public.crm_payment_operations enable row level security;
alter table public.crm_payment_operation_events enable row level security;
revoke all on public.crm_payment_operations, public.crm_payment_operation_events from anon, authenticated;
grant select,insert,update on public.crm_payment_operations to service_role;
grant select,insert on public.crm_payment_operation_events to service_role;

create or replace function public.reserve_direct_payment(
 p_operation_key text,p_account text,p_mode text,p_hash text,p_quote_id text,p_lead_id text,
 p_kind text,p_amount_minor bigint,p_expected_revision integer,p_actor_id text
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare q jsonb; op public.crm_payment_operations; paid numeric; remaining numeric;
begin
 if length(p_operation_key)<16 or length(p_operation_key)>128 or p_amount_minor<=0 then raise exception 'Invalid payment command'; end if;
 select data into q from public.crm_quotes where id=p_quote_id and not deleted for update;
 if q is null or q->>'leadId' is distinct from p_lead_id then raise exception 'Quote ownership mismatch'; end if;
 select * into op from public.crm_payment_operations where provider_account=p_account and provider_mode=p_mode and operation_key=p_operation_key;
 if found then
  if op.request_hash<>p_hash or op.quote_id<>p_quote_id or op.lead_id<>p_lead_id then raise exception 'Payment command inputs changed'; end if;
  return jsonb_build_object('created',false,'operation',to_jsonb(op));
 end if;
 if exists(select 1 from public.crm_payment_operations where quote_id=p_quote_id and state not in ('complete','failed')) then raise exception 'Previous payment requires reconciliation'; end if;
 if exists(select 1 from public.crm_checkout_operations where quote_id=p_quote_id and state in ('reserved','open','unknown')) then raise exception 'Customer checkout is pending; reconcile or expire it before collecting by card'; end if;
 if coalesce((q->>'revision')::integer,0)<>p_expected_revision then raise exception 'Quote changed; reload before charging'; end if;
 if nullif(q->>'stripeAccountKey','') is not null and q->>'stripeAccountKey'<>p_account then raise exception 'Payment account mismatch'; end if;
 select greatest(coalesce(sum(greatest(coalesce((r->>'amount')::numeric,0),0)),0),coalesce((q->>'depositPaidAmount')::numeric,0)+coalesce((q->>'balancePaidAmount')::numeric,0)) into paid from jsonb_array_elements(coalesce(q->'paymentRecords','[]')) r;
 remaining:=round((coalesce((q->>'total')::numeric,0)-paid)*100);
 if p_amount_minor>remaining then raise exception 'Charge exceeds unpaid quote amount'; end if;
 if p_kind='deposit' and (paid>0 or nullif(q->>'depositPaidAt','') is not null) then raise exception 'Deposit already recorded; reconcile before another deposit'; end if;
 insert into public.crm_payment_operations(operation_key,provider_account,provider_mode,request_hash,quote_id,lead_id,kind,amount_minor,currency,actor_id)
 values(p_operation_key,p_account,p_mode,p_hash,p_quote_id,p_lead_id,p_kind,p_amount_minor,'cad',p_actor_id) returning * into op;
 insert into public.crm_payment_operation_events(operation_id,event_type) values(op.id,'payment.reserved');
 return jsonb_build_object('created',true,'operation',to_jsonb(op));
end $$;

create or replace function public.apply_direct_payment(p_operation_id uuid,p_record jsonb,p_card_brand text,p_card_last4 text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare op public.crm_payment_operations; q jsonb; l jsonb; paid numeric; after_paid numeric; amount numeric; remaining numeric; ts text; record jsonb;
begin
 select * into op from public.crm_payment_operations where id=p_operation_id for update;
 if not found or op.state not in ('provider_succeeded','complete') or op.provider_intent_id is null then raise exception 'Verified successful payment required'; end if;
 select data into q from public.crm_quotes where id=op.quote_id and not deleted for update;
 select data into l from public.crm_leads where id=op.lead_id and not deleted for update;
 if q is null or l is null or q->>'leadId' is distinct from op.lead_id then raise exception 'Payment target missing'; end if;
 if op.state='complete' then return jsonb_build_object('quote',q,'lead',l,'replayed',true); end if;
 if exists(select 1 from jsonb_array_elements(coalesce(q->'paymentRecords','[]')) r where r->>'reference'=op.provider_intent_id) then
  -- A legacy writer may have projected the provider result. Do not allocate again.
  raise exception 'Provider payment already exists outside operation; manual reconciliation required';
 end if;
 if p_record->>'reference' is distinct from op.provider_intent_id or round((p_record->>'amount')::numeric*100)<>op.amount_minor then raise exception 'Payment record mismatch'; end if;
 select greatest(coalesce(sum(greatest(coalesce((r->>'amount')::numeric,0),0)),0),coalesce((q->>'depositPaidAmount')::numeric,0)+coalesce((q->>'balancePaidAmount')::numeric,0)) into paid from jsonb_array_elements(coalesce(q->'paymentRecords','[]')) r;
 amount:=op.amount_minor/100.0; after_paid:=paid+amount; remaining:=greatest(0,coalesce((q->>'total')::numeric,0)-after_paid); ts:=now()::text;
 record:=p_record || jsonb_build_object('amount',amount,'paidBeforePayment',paid,'paidAfterPayment',after_paid,'balanceAfterPayment',remaining,'totalBeforePayment',(q->>'total')::numeric);
 q:=q || jsonb_build_object('paymentRecords',coalesce(q->'paymentRecords','[]') || jsonb_build_array(record),'balance',remaining,'stripeAccountKey',op.provider_account,'revision',coalesce((q->>'revision')::integer,0)+1);
 if op.kind='deposit' then
  q:=q || jsonb_build_object('depositPaidAt',ts,'depositPaidAmount',amount,'depositPaidMethod','stripe','depositStripePaymentIntentId',op.provider_intent_id,'depositStripeCardBrand',p_card_brand,'depositStripeCardLast4',p_card_last4);
  l:=l || jsonb_build_object('depositAmount',amount,'depositMethod','Credit Card','depositDate',current_date::text);
 else
  q:=q || jsonb_build_object('balancePaidAt',ts,'balancePaidAmount',coalesce((q->>'balancePaidAmount')::numeric,0)+amount,'balancePaidMethod','stripe');
 end if;
 l:=l || jsonb_build_object('paymentStatus',case when remaining<=0 then 'paid_in_full' else 'deposit_received' end);
 -- Commercial confirmation does not claim that crew or vehicle assignment is complete.
 if coalesce(l->>'stage','') not in ('booked','completed','customer_success')
    and q->>'status' in ('accepted','invoiced') and coalesce((q->>'deposit')::numeric,0)>0
    and coalesce((q->>'depositPaidAmount')::numeric,0)>=coalesce((q->>'deposit')::numeric,0) then
  l:=l || jsonb_build_object('stage','booked','bookedAt',ts);
  if l->>'tentativeReservationStatus'='active' then l:=l || jsonb_build_object('tentativeReservationStatus','converted'); end if;
 end if;
 update public.crm_quotes set data=q,updated_at=now() where id=op.quote_id;
 update public.crm_leads set data=l,updated_at=now() where id=op.lead_id;
 update public.crm_payment_operations set state='complete',updated_at=now() where id=op.id;
 insert into public.crm_payment_operation_events(operation_id,event_type,details) values(op.id,'payment.applied',jsonb_build_object('provider_intent_id',op.provider_intent_id,'amount_minor',op.amount_minor));
 return jsonb_build_object('quote',q,'lead',l,'replayed',false);
end $$;
revoke all on function public.reserve_direct_payment(text,text,text,text,text,text,text,bigint,integer,text) from public,anon,authenticated;
revoke all on function public.apply_direct_payment(uuid,jsonb,text,text) from public,anon,authenticated;
grant execute on function public.reserve_direct_payment(text,text,text,text,text,text,text,bigint,integer,text) to service_role;
grant execute on function public.apply_direct_payment(uuid,jsonb,text,text) to service_role;
create or replace function public.prevent_payment_event_rewrite() returns trigger language plpgsql as $$ begin raise exception 'Payment operation events are append-only'; end $$;
drop trigger if exists payment_events_immutable on public.crm_payment_operation_events;
create trigger payment_events_immutable before update or delete on public.crm_payment_operation_events for each row execute function public.prevent_payment_event_rewrite();
