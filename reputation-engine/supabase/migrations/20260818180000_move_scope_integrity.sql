-- Canonical, immutable scope versions. Existing CRM JSON remains the intake
-- workspace; these rows become the accepted operational contract.
create table if not exists public.move_scope_versions (
  id uuid primary key default gen_random_uuid(),
  scope_code text not null unique,
  lead_id text not null,
  quote_id text,
  version integer not null check (version > 0),
  predecessor_id uuid references public.move_scope_versions(id),
  change_reason text,
  snapshot jsonb not null,
  snapshot_hash text not null,
  status text not null default 'draft' check (status in ('draft','issued','accepted','superseded','cancelled')),
  issued_at timestamptz,
  accepted_at timestamptz,
  accepted_by_name text,
  acceptance_method text,
  acceptance_ip text,
  created_by text,
  created_at timestamptz not null default now(),
  unique (lead_id, version)
);
create index if not exists move_scope_versions_lead_idx on public.move_scope_versions(lead_id, version desc);
create unique index if not exists move_scope_versions_active_idx on public.move_scope_versions(lead_id) where status = 'accepted';

create or replace function public.reject_move_scope_snapshot_mutation() returns trigger language plpgsql as $$
begin
  if old.status in ('issued','accepted','superseded') and (
    new.snapshot is distinct from old.snapshot or new.snapshot_hash is distinct from old.snapshot_hash or
    new.lead_id is distinct from old.lead_id or new.quote_id is distinct from old.quote_id or new.version is distinct from old.version
  ) then raise exception 'Issued move scope snapshots are immutable; create a new version'; end if;
  if old.status = 'accepted' and new.status not in ('accepted','superseded') then
    raise exception 'Accepted move scope can only be superseded by a new version';
  end if;
  return new;
end $$;
drop trigger if exists move_scope_versions_immutable on public.move_scope_versions;
create trigger move_scope_versions_immutable before update on public.move_scope_versions
for each row execute function public.reject_move_scope_snapshot_mutation();

create table if not exists public.move_scope_acknowledgements (
  id uuid primary key default gen_random_uuid(),
  scope_version_id uuid not null references public.move_scope_versions(id),
  party_type text not null check (party_type in ('customer','subcontractor','internal')),
  party_id text,
  party_name text,
  decision text not null check (decision in ('accepted','declined','acknowledged')),
  method text not null,
  ip_address text,
  user_agent text,
  acknowledged_at timestamptz not null default now(),
  metadata jsonb not null default '{}'
);
create index if not exists move_scope_ack_scope_idx on public.move_scope_acknowledgements(scope_version_id, acknowledged_at);

alter table public.subcontractor_offers add column if not exists scope_version_id uuid references public.move_scope_versions(id);
alter table public.subcontractor_offer_recipients add column if not exists acknowledged_scope_version_id uuid references public.move_scope_versions(id);

create table if not exists public.move_scope_walkthroughs (
  id uuid primary key default gen_random_uuid(),
  lead_id text not null,
  scope_version_id uuid not null references public.move_scope_versions(id),
  assignment_id uuid references public.partner_job_assignments(id) on delete set null,
  subcontractor_id uuid references public.subcontractors(id) on delete set null,
  verification jsonb not null,
  outcome text not null check (outcome in ('match','discrepancy')),
  status text not null default 'completed' check (status in ('in_progress','completed','discrepancy_resolved','cancelled')),
  completed_by text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists move_scope_walkthroughs_lead_idx on public.move_scope_walkthroughs(lead_id, created_at desc);

-- Quote acceptance is the hard commitment boundary. Capture the complete lead
-- and quote JSON at the database layer so every acceptance path is covered,
-- including Stripe/webhook flows that do not call the scope API first.
create or replace function public.capture_accepted_move_scope() returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_lead jsonb;
  v_lead_id text;
  v_version integer;
  v_scope_id uuid;
  v_snapshot jsonb;
begin
  if coalesce(new.data->>'status','') <> 'accepted' or coalesce(old.data->>'status','') = 'accepted' then return new; end if;
  v_lead_id := new.data->>'leadId';
  if v_lead_id is null then return new; end if;
  select data into v_lead from public.crm_leads where id = v_lead_id and deleted = false limit 1;
  if v_lead is null then raise exception 'Cannot accept quote without its CRM lead'; end if;

  select id into v_scope_id from public.move_scope_versions
    where lead_id = v_lead_id and quote_id = new.id and status = 'issued' order by version desc limit 1;
  if v_scope_id is not null then
    update public.move_scope_versions set status = 'superseded'
      where lead_id = v_lead_id and status = 'accepted' and id <> v_scope_id;
    update public.move_scope_versions set status = 'accepted', accepted_at = now(), accepted_by_name = coalesce(v_lead->>'name','Customer'), acceptance_method = 'quote_acceptance', acceptance_ip = new.data->>'termsAcceptedIp'
      where id = v_scope_id;
  else
    select coalesce(max(version),0) + 1 into v_version from public.move_scope_versions where lead_id = v_lead_id;
    v_snapshot := jsonb_build_object(
      'schemaVersion', 1, 'leadId', v_lead_id, 'quoteId', new.id, 'generatedAt', now(),
      'capturedLead', v_lead, 'capturedQuote', new.data
    );
    update public.move_scope_versions set status = 'superseded' where lead_id = v_lead_id and status = 'accepted';
    insert into public.move_scope_versions(scope_code,lead_id,quote_id,version,change_reason,snapshot,snapshot_hash,status,issued_at,accepted_at,accepted_by_name,acceptance_method,acceptance_ip,created_by)
    values ('SSM-' || upper(right(regexp_replace(v_lead_id,'[^a-zA-Z0-9]','','g'),8)) || '-V' || v_version,
      v_lead_id,new.id,v_version,'Captured at quote acceptance',v_snapshot,encode(digest(v_snapshot::text,'sha256'),'hex'),'accepted',now(),now(),coalesce(v_lead->>'name','Customer'),'quote_acceptance',new.data->>'termsAcceptedIp','database_acceptance_gate')
    returning id into v_scope_id;
  end if;
  insert into public.move_scope_acknowledgements(scope_version_id,party_type,party_id,party_name,decision,method,ip_address,user_agent,metadata)
  values(v_scope_id,'customer',v_lead_id,coalesce(v_lead->>'name','Customer'),'accepted','quote_acceptance',new.data->>'termsAcceptedIp',new.data->>'termsAcceptedUserAgent',jsonb_build_object('termsVersion',new.data->>'termsAcceptedVersion'));
  return new;
end $$;
drop trigger if exists crm_quotes_capture_accepted_scope on public.crm_quotes;
create trigger crm_quotes_capture_accepted_scope after update of data on public.crm_quotes
for each row execute function public.capture_accepted_move_scope();

create or replace function public.bind_offer_to_active_scope() returns trigger language plpgsql as $$
begin
  if new.scope_version_id is null then
    select id into new.scope_version_id from public.move_scope_versions where lead_id = new.lead_id and status = 'accepted' order by version desc limit 1;
  end if;
  return new;
end $$;
drop trigger if exists subcontractor_offers_bind_scope on public.subcontractor_offers;
create trigger subcontractor_offers_bind_scope before insert or update of lead_id on public.subcontractor_offers
for each row execute function public.bind_offer_to_active_scope();

create or replace function public.capture_partner_scope_acknowledgement() returns trigger language plpgsql as $$
declare v_scope_id uuid; v_name text;
begin
  if new.status = 'accepted' and old.status is distinct from 'accepted' then
    select scope_version_id into v_scope_id from public.subcontractor_offers where id = new.offer_id;
    if v_scope_id is null then raise exception 'Subcontractor cannot accept an offer without an accepted scope version'; end if;
    new.acknowledged_scope_version_id := v_scope_id;
    select company_name into v_name from public.subcontractors where id = new.subcontractor_id;
    insert into public.move_scope_acknowledgements(scope_version_id,party_type,party_id,party_name,decision,method,metadata)
    values(v_scope_id,'subcontractor',new.subcontractor_id::text,v_name,'accepted','offer_portal',jsonb_build_object('offerId',new.offer_id));
  end if;
  return new;
end $$;
drop trigger if exists subcontractor_recipients_capture_scope_ack on public.subcontractor_offer_recipients;
create trigger subcontractor_recipients_capture_scope_ack before update of status on public.subcontractor_offer_recipients
for each row execute function public.capture_partner_scope_acknowledgement();

create or replace function public.enforce_scope_before_partner_work() returns trigger language plpgsql as $$
begin
  if new.event_type = 'walkthrough_complete' and not exists (
    select 1 from public.move_scope_walkthroughs w where w.lead_id = new.lead_id and w.status in ('completed','discrepancy_resolved')
  ) then raise exception 'Structured arrival walkthrough is required'; end if;
  if new.event_type = 'work_started' and not exists (
    select 1 from public.move_scope_walkthroughs w where w.lead_id = new.lead_id and
      (w.outcome = 'match' and w.status = 'completed' or w.status = 'discrepancy_resolved')
  ) then raise exception 'Active scope must match or the walkthrough discrepancy must be resolved before work starts'; end if;
  return new;
end $$;
drop trigger if exists partner_job_events_scope_gate on public.partner_job_events;
create trigger partner_job_events_scope_gate before insert on public.partner_job_events
for each row execute function public.enforce_scope_before_partner_work();

alter table public.move_scope_versions enable row level security;
alter table public.move_scope_acknowledgements enable row level security;
alter table public.move_scope_walkthroughs enable row level security;
