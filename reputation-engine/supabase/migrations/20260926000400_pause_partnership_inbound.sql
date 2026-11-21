-- Persist the pause and cancel pending work in one transaction before drafting/notifications.
create or replace function public.pause_partnership_inbound(p_contact_id uuid,p_channel text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare cancelled integer;
begin
 if p_channel is null or p_channel not in ('sms','email','phone') then raise exception 'Invalid inbound channel'; end if;
 update public.market_contacts set sequence_paused=true,sequence_paused_reason=p_channel||'_reply' where id=p_contact_id;
 if not found then raise exception 'Partnership contact missing'; end if;
 update public.sequence_jobs set status='cancelled',error='Paused after inbound '||p_channel where contact_id=p_contact_id and status='pending';
 get diagnostics cancelled=row_count;
 return jsonb_build_object('paused',true,'contact_id',p_contact_id,'cancelled_pending',cancelled);
end $$;
revoke all on function public.pause_partnership_inbound(uuid,text) from public,anon,authenticated;
grant execute on function public.pause_partnership_inbound(uuid,text) to service_role;
