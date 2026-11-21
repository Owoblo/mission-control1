begin;
create table if not exists public.contractor_onboarding_cases (
 id uuid primary key default gen_random_uuid(), source_key text unique not null,
 subcontractor_id uuid references public.subcontractors(id),
 display_name text not null,city text not null default '',phone text not null default '',email text not null default '',
 interest text not null default 'confirm',source_group text not null default 'main',source_note text not null default '',hold_reason text not null default '',
 stage text not null default 'interested' check(stage in ('interested','screening','collecting','ready','approved','paused')),
 assignee_id text, next_action text not null default '',follow_up_at date,
 profile jsonb not null default '{}'::jsonb,checklist jsonb not null default '{}'::jsonb,trial_notes text not null default '',
 updated_by text,created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create index if not exists contractor_onboarding_cases_city_stage on public.contractor_onboarding_cases(city,stage);
create table if not exists public.contractor_payment_documents (
 id uuid primary key default gen_random_uuid(), invite_id uuid not null references public.partner_onboarding_invites(id),
 object_path text not null,filename text not null,created_at timestamptz not null default now(),
 verified_at timestamptz,verified_by text
);
alter table public.contractor_onboarding_cases enable row level security;
alter table public.contractor_payment_documents enable row level security;
revoke all on public.contractor_onboarding_cases,public.contractor_payment_documents from anon,authenticated;
grant all on public.contractor_onboarding_cases,public.contractor_payment_documents to service_role;
-- A separate private bucket prevents general onboarding-document access from exposing bank files.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('contractor-payment','contractor-payment',false,4194304,array['application/pdf','image/jpeg','image/png'])
on conflict(id) do nothing;
notify pgrst,'reload schema';
commit;
