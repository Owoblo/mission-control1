-- Safe upgrade for environments where the original offer portal migration was
-- deployed before eligibility, manual award, and response tracking were added.
alter table public.subcontractors
  add column if not exists service_tags text[] not null default '{}'::text[],
  add column if not exists availability_notes text,
  add column if not exists completed_jobs integer not null default 0,
  add column if not exists cancelled_jobs integer not null default 0,
  add column if not exists average_rating numeric(3,2);

alter table public.subcontractor_offers
  add column if not exists arrival_window text,
  add column if not exists required_service_tags text[] not null default '{}'::text[],
  add column if not exists award_policy text not null default 'first_acceptance';

do $$ begin
  alter table public.subcontractor_offers add constraint subcontractor_offers_award_policy_check
    check (award_policy in ('first_acceptance', 'manual_selection'));
exception when duplicate_object then null;
end $$;

create or replace function public.respond_to_subcontractor_offer(p_token uuid, p_action text, p_note text default null)
returns table (outcome text, offer_id uuid, subcontractor_id uuid, awarded_subcontractor_id uuid)
language plpgsql security definer set search_path = public as $$
declare
  v_rec public.subcontractor_offer_recipients%rowtype;
  v_offer public.subcontractor_offers%rowtype;
begin
  if p_action not in ('accept', 'decline', 'discussion', 'view') then raise exception 'Invalid offer response action'; end if;
  select * into v_rec from public.subcontractor_offer_recipients where token = p_token for update;
  if not found then return query select 'not_found'::text, null::uuid, null::uuid, null::uuid; return; end if;
  if p_action = 'view' then
    update public.subcontractor_offer_recipients
      set status = case when status in ('pending', 'sent') then 'viewed' else status end,
          viewed_at = coalesce(viewed_at, now()), updated_at = now()
      where id = v_rec.id;
    return query select 'viewed'::text, v_rec.offer_id, v_rec.subcontractor_id, null::uuid; return;
  end if;
  select * into v_offer from public.subcontractor_offers where id = v_rec.offer_id for update;
  if v_offer.status = 'awarded' then
    return query select case when v_offer.awarded_subcontractor_id = v_rec.subcontractor_id then 'accepted' else 'already_awarded' end,
      v_offer.id, v_rec.subcontractor_id, v_offer.awarded_subcontractor_id; return;
  end if;
  if v_offer.status <> 'open' or (v_offer.expires_at is not null and v_offer.expires_at <= now()) then
    return query select 'closed'::text, v_offer.id, v_rec.subcontractor_id, v_offer.awarded_subcontractor_id; return;
  end if;
  if p_action in ('decline', 'discussion') then
    update public.subcontractor_offer_recipients set status = p_action,
      response_note = nullif(trim(coalesce(p_note, '')), ''), responded_at = now(), updated_at = now() where id = v_rec.id;
    return query select p_action, v_offer.id, v_rec.subcontractor_id, v_offer.awarded_subcontractor_id; return;
  end if;
  if v_offer.award_policy = 'manual_selection' then
    update public.subcontractor_offer_recipients set status = 'discussion',
      response_note = coalesce(nullif(trim(coalesce(p_note, '')), ''), 'Available — awaiting dispatcher award'), responded_at = now(), updated_at = now()
      where id = v_rec.id;
    return query select 'available'::text, v_offer.id, v_rec.subcontractor_id, null::uuid; return;
  end if;
  update public.subcontractor_offers set status = 'awarded', awarded_subcontractor_id = v_rec.subcontractor_id,
    awarded_at = now(), updated_at = now() where id = v_offer.id;
  update public.subcontractor_offer_recipients
    set status = case when subcontractor_id = v_rec.subcontractor_id then 'accepted' else 'not_awarded' end,
        responded_at = case when subcontractor_id = v_rec.subcontractor_id then now() else responded_at end, updated_at = now()
    where offer_id = v_offer.id and status not in ('declined', 'discussion');
  return query select 'accepted'::text, v_offer.id, v_rec.subcontractor_id, v_rec.subcontractor_id;
end;
$$;

revoke all on function public.respond_to_subcontractor_offer(uuid, text, text) from public;
grant execute on function public.respond_to_subcontractor_offer(uuid, text, text) to service_role;

create or replace function public.award_subcontractor_offer(p_offer_id uuid, p_subcontractor_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  update public.subcontractor_offers set status = 'awarded', awarded_subcontractor_id = p_subcontractor_id,
    awarded_at = now(), updated_at = now()
  where id = p_offer_id and status = 'open' and (expires_at is null or expires_at > now())
    and exists (select 1 from public.subcontractor_offer_recipients where offer_id = p_offer_id and subcontractor_id = p_subcontractor_id);
  if not found then return false; end if;
  update public.subcontractor_offer_recipients
    set status = case when subcontractor_id = p_subcontractor_id then 'accepted' else 'not_awarded' end,
        responded_at = case when subcontractor_id = p_subcontractor_id then now() else responded_at end, updated_at = now()
    where offer_id = p_offer_id and status not in ('declined');
  return true;
end;
$$;

revoke all on function public.award_subcontractor_offer(uuid, uuid) from public;
grant execute on function public.award_subcontractor_offer(uuid, uuid) to service_role;
