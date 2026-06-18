alter table if exists public.market_contacts
  add column if not exists source_signal_id uuid references public.market_signals(id) on delete set null,
  add column if not exists linked_partner_id text,
  add column if not exists digital_package_sent_at timestamp with time zone,
  add column if not exists digital_package_sent_by text,
  add column if not exists physical_cards_dropped_at timestamp with time zone,
  add column if not exists physical_cards_dropped_by text,
  add column if not exists referral_code_assigned_at timestamp with time zone,
  add column if not exists referral_code_assigned_by text;

create index if not exists market_contacts_source_signal_id_idx on public.market_contacts(source_signal_id);
create index if not exists market_contacts_linked_partner_id_idx on public.market_contacts(linked_partner_id);
create index if not exists market_contacts_package_status_idx
  on public.market_contacts(digital_package_sent_at, physical_cards_dropped_at, referral_code_assigned_at);

alter table if exists public.market_queue
  add column if not exists outcome_code text,
  add column if not exists outcome_note text;
