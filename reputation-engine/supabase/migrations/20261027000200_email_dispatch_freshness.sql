-- Recheck freshness at the last transport claim, including resumed reservations.
create or replace function public.start_crm_email(p_attempt uuid,p_content_hash text) returns boolean
language plpgsql security definer set search_path=public,pg_temp as $$
declare r crm_email_requests;
begin
 if p_content_hash !~ '^[a-f0-9]{64}$' then raise exception 'Transport fingerprint is required'; end if;
 select q.* into r from crm_email_requests q join crm_email_attempts a on a.request_id=q.id where a.id=p_attempt;
 if r.purpose='outreach' and exists(select 1 from crm_email_attempts where id=p_attempt and state='prepared' and created_at<now()-interval '5 minutes') then raise exception 'Outreach reservation expired; review before preparing another send'; end if;
 if r.purpose='outreach' and not exists(select 1 from crm_email_provider_health h join email_sender_accounts s on coalesce(s.region,'us-east-2')=h.region where s.provider='ses' and lower(s.from_email)=r.from_address and h.checked_at>now()-interval '15 minutes' and h.snapshot->>'sendingEnabled'='true' and h.snapshot->>'production'='true' and h.snapshot->>'enforcement'='HEALTHY') then raise exception 'SES account health expired before dispatch'; end if;
 if r.purpose='outreach' and not exists(select 1 from email_sender_accounts s join crm_email_domains d on d.domain=s.domain where lower(s.from_email)=r.from_address and s.provider='ses' and s.status in ('warming','active') and d.status in ('warming','active') and d.checked_at>now()-interval '1 hour' and d.health->>'ready'='true') then raise exception 'Sender paused before dispatch'; end if;
 if r.purpose='outreach' and exists(select 1 from market_contacts c where lower(c.email)=r.recipients->>0 and (c.do_not_contact or c.cross_channel_suppressed_at is not null or c.email_unsubscribed_at is not null or c.email_status in ('bounced','complained','unsubscribed'))) then raise exception 'Recipient opted out before dispatch'; end if;
 if r.purpose='outreach' and exists(select 1 from crm_email_suppressions where recipient=r.recipients->>0) then raise exception 'Recipient opted out before dispatch'; end if;
 update crm_email_attempts set state='dispatching',dispatched_at=now(),transport_fingerprint=p_content_hash where id=p_attempt and state='prepared';
 return found;
end $$;
