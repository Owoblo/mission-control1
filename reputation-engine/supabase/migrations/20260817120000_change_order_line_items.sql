alter table public.partner_change_orders
  add column if not exists line_items jsonb not null default '[]';

comment on column public.partner_change_orders.line_items is
  'Auditable charge and credit lines. Signed customer_delta and partner_delta are the net totals.';
