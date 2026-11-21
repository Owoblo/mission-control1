-- Scheduling is a system event, not an already-sent outbound message.
alter table public.market_touches drop constraint if exists market_touches_direction_check;
alter table public.market_touches add constraint market_touches_direction_check
 check (direction in ('inbound','outbound','system'));
