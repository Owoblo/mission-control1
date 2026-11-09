-- A correlated hard bounce stops this contact across the existing email queues.
create function public.record_google_mail_bounce(p_email text,p_message text,p_job uuid,p_occurred timestamptz) returns boolean
language plpgsql security definer set search_path=public,pg_temp as $$
declare j google_mail_jobs%rowtype; recorded boolean;
begin
 perform pg_advisory_xact_lock(hashtextextended('google-mail-dispatch',0));
 select * into j from google_mail_jobs where id=p_job and state='accepted' and payload->>'replyTo'=p_email;
 if not found then raise exception 'Bounce does not match accepted outbound mail'; end if;
 recorded:=record_google_mail_inbound(p_email,p_message,j.contact_id,j.thread_id,p_occurred,'hard_bounce');
 update market_contacts set email_status='bounced',sequence_paused=true,sequence_paused_reason='google_hard_bounce' where id=j.contact_id;
 update google_mail_jobs set state='cancelled',error='Correlated hard bounce' where contact_id=j.contact_id and state in ('pending','held');
 return recorded;
end $$;
revoke all on function public.record_google_mail_bounce(text,text,uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.record_google_mail_bounce(text,text,uuid,timestamptz) to service_role;
