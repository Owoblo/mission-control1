-- One-use notification capability. Delivery state is separate from Twilio acceptance.
create table if not exists public.partnership_email_sms_replies (
 token_hash text primary key,
 contact_id uuid not null references public.market_contacts(id),
 source_touch_id uuid not null references public.market_touches(id),
 operator_email text not null,
 from_number text not null,
 to_number text not null,
 created_at timestamptz not null default now(),
 expires_at timestamptz not null,
 status text not null default 'pending' check(status in ('pending','processing','accepted','review_required')),
 inbound_message_id text,
 result jsonb,
 check(expires_at > created_at)
);
alter table public.partnership_email_sms_replies enable row level security;
revoke all on public.partnership_email_sms_replies from public, anon, authenticated;
grant select, insert, update on public.partnership_email_sms_replies to service_role;
create unique index if not exists partnership_email_sms_message_id
 on public.partnership_email_sms_replies(inbound_message_id) where inbound_message_id is not null;

-- Different notification recipients must not race two answers to the same inbound.
create unique index if not exists partnership_email_sms_inbound_claim
 on public.partnership_email_sms_replies(source_touch_id) where status <> 'pending';
