-- Deploy before the application. Raw receipts and decisions are append-only.
create table if not exists public.crm_interactions (
 id text primary key,
 event jsonb not null,
 received_at timestamptz not null default now()
);
create table if not exists public.crm_interaction_classifications (
 id bigint generated always as identity primary key,
 interaction_id text not null references public.crm_interactions(id),
 classification jsonb not null,
 reviewer_id text,
 reviewed_at timestamptz not null default now(),
 supersedes bigint references public.crm_interaction_classifications(id),
 lead_id text,
 check(classification->>'actor' in ('prospect','partner','existing_customer','employee','vendor','spam_scam','wrong_number','unknown')),
 check(classification->>'intent' in ('quote_request','booking_request','moving_question','existing_customer_support','partnership_inquiry','referral','payment_issue','employee_internal','spam','wrong_recipient','no_commercial_intent','unknown')),
 check(classification->>'disposition' in ('not_a_lead','lead_candidate','qualified_lead','customer','partner_opportunity','support_case')),
 check(classification ?& array['actor','intent','disposition','confidence','reason']),
 check((classification->>'confidence')::numeric between 0 and 1)
);
create index if not exists crm_interaction_review_idx on public.crm_interaction_classifications(interaction_id,id desc);
create index if not exists crm_interaction_lead_idx on public.crm_interaction_classifications(lead_id,id desc);
alter table public.crm_interactions enable row level security;
alter table public.crm_interaction_classifications enable row level security;
revoke all on public.crm_interactions,public.crm_interaction_classifications from anon,authenticated,service_role;
grant select,insert on public.crm_interactions,public.crm_interaction_classifications to service_role;
grant usage,select on sequence public.crm_interaction_classifications_id_seq to service_role;

create or replace function public.crm_deny_history_mutation() returns trigger language plpgsql as $$
begin raise exception 'Interaction history is append-only; record a correction'; end $$;
create trigger crm_raw_immutable before update or delete on public.crm_interactions for each row execute function public.crm_deny_history_mutation();
create trigger crm_classification_immutable before update or delete on public.crm_interaction_classifications for each row execute function public.crm_deny_history_mutation();

create table public.crm_interaction_links (
 interaction_id text not null references public.crm_interactions(id),
 lead_id text not null,
 linked_at timestamptz not null default now(),
 primary key(interaction_id,lead_id)
);
alter table public.crm_interaction_links enable row level security;
revoke all on public.crm_interaction_links from anon,authenticated,service_role;
grant select,insert on public.crm_interaction_links to service_role;
create trigger crm_link_immutable before update or delete on public.crm_interaction_links for each row execute function public.crm_deny_history_mutation();

create or replace function public.crm_interaction_identity(value text) returns text language sql immutable as $$
 select case when position('@' in value)>0 then lower(trim(value))
 when length(regexp_replace(value,'\D','','g'))=10 then '1'||regexp_replace(value,'\D','','g')
 else regexp_replace(value,'\D','','g') end;
$$;

create or replace function public.capture_crm_interaction(p_id text,p_event jsonb,p_classification jsonb)
returns text language plpgsql security definer set search_path=public,pg_temp as $$
declare target text; sender text;
begin
 insert into crm_interactions(id,event) values(p_id,p_event) on conflict do nothing;
 if found then
   insert into crm_interaction_classifications(interaction_id,classification,lead_id)
   values(p_id,p_classification,p_event->>'leadId');
 end if;
 sender:=p_event->>'sender';
 target:=p_event->>'leadId';
 if target is null and sender is not null then
   select id into target from crm_leads where not deleted and
     ((position('@' in sender)>0 and lower(data->>'email')=lower(sender)) or
      (position('@' in sender)=0 and length(regexp_replace(sender,'\D','','g'))>=10 and
       crm_interaction_identity(data->>'phone')=crm_interaction_identity(sender)))
     order by updated_at desc limit 1;
 end if;
 if target is not null then
   insert into crm_interaction_links(interaction_id,lead_id) values(p_id,target) on conflict do nothing;
 end if;
 return p_id;
end $$;

-- Preserve every legacy record, without pretending a stage proves qualification.
insert into public.crm_interactions(id,event)
select 'legacy:'||id,jsonb_build_object('source','legacy_crm','channel','legacy','leadId',id,'raw',data,'occurredAt',data->>'createdAt','timezone',null)
from public.crm_leads on conflict do nothing;
insert into public.crm_interaction_classifications(interaction_id,classification,lead_id)
select i.id,jsonb_build_object('actor','unknown','intent','unknown','disposition','lead_candidate','confidence',0,'reason','Legacy record retained; requires evidence review'),i.event->>'leadId'
from public.crm_interactions i where i.id like 'legacy:%' and not exists(select 1 from public.crm_interaction_classifications c where c.interaction_id=i.id);

-- Capture legacy intake writers as well (forms, imported messages and call updates).
create or replace function public.crm_capture_inbound_snapshot() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 perform capture_crm_interaction('inbound:'||new.id||':'||md5(to_jsonb(new)::text),
 jsonb_build_object('source',new.source,'channel',case when new.source like '%sms%' then 'sms' when new.source like '%call%' then 'call' when new.source like '%email%' then 'email' else 'web_form' end,'sender',coalesce(new.phone,new.email),'body',new.message,'occurredAt',new.created_at,'raw',to_jsonb(new),'inboundId',new.id),
 jsonb_build_object('actor','unknown','intent','unknown','disposition','lead_candidate','confidence',0,'reason','Intake snapshot; requires classification'));
 return new;
end $$;
create trigger crm_capture_inbound after insert or update on public.inbound_leads for each row execute function public.crm_capture_inbound_snapshot();

create or replace view public.crm_interaction_review_queue with (security_invoker=true) as
select i.*,c.id as classification_id,c.classification,c.reviewer_id,c.reviewed_at,coalesce(c.lead_id,(select l.lead_id from public.crm_interaction_links l where l.interaction_id=i.id order by l.linked_at limit 1)) as lead_id
from public.crm_interactions i join lateral
(select * from public.crm_interaction_classifications where interaction_id=i.id order by id desc limit 1)c on true;
grant select on public.crm_interaction_review_queue to service_role;

create or replace function public.review_crm_interaction(p_id text,p_expected bigint,p_classification jsonb,p_reviewer text,p_promote boolean default false)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare e jsonb; previous crm_interaction_classifications; next_id bigint; target text; disposition text; evidence jsonb; sender text; lead_data jsonb;
begin
 select event into e from crm_interactions where id=p_id for update;
 if not found then raise exception 'Interaction not found'; end if;
 select * into previous from crm_interaction_classifications where interaction_id=p_id order by id desc limit 1;
 if previous.id is distinct from p_expected then raise exception 'Classification changed; reload before reviewing'; end if;
 if nullif(trim(p_reviewer),'') is null or nullif(trim(p_classification->>'reason'),'') is null then raise exception 'Reviewer and reason required'; end if;
 disposition:=p_classification->>'disposition'; evidence:=p_classification->'evidence';
 if disposition in ('qualified_lead','customer','partner_opportunity') then
   if p_classification->>'actor' not in ('prospect','existing_customer','partner') then raise exception 'Commercial actor required'; end if;
   if p_classification->>'intent' not in ('quote_request','booking_request','moving_question','referral','partnership_inquiry') then raise exception 'Commercial intent required'; end if;
   if not coalesce(evidence @> '{"movingIntent":true,"serviceableLocation":true,"realIdentity":true,"usableContact":true,"plausibleOpportunity":true}',false)
      or nullif(trim(evidence->>'location'),'') is null then raise exception 'All qualification evidence and service location required'; end if;
 end if;
 target:=previous.lead_id;
 if target is null then select lead_id into target from crm_interaction_links where interaction_id=p_id order by linked_at limit 1; end if;
 if p_promote and disposition not in ('qualified_lead','customer','partner_opportunity') then raise exception 'Only verified opportunities can be promoted'; end if;
 if p_promote and target is null then
   sender:=e->>'sender';
   if nullif(trim(sender),'') is null then raise exception 'Contact required'; end if;
   if not (sender ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or
       (position('@' in sender)=0 and length(regexp_replace(sender,'\D','','g')) between 10 and 15)) then raise exception 'Usable phone or email required'; end if;
   perform pg_advisory_xact_lock(hashtextextended(crm_interaction_identity(sender),0));
   select id into target from crm_leads where not deleted and
     ((position('@' in sender)>0 and lower(data->>'email')=lower(sender)) or
      (position('@' in sender)=0 and length(regexp_replace(sender,'\D','','g'))>=10 and
       crm_interaction_identity(data->>'phone')=crm_interaction_identity(sender)))
     order by updated_at desc limit 1;
   if target is null then
     target:='interaction_'||p_id;
     lead_data:=jsonb_build_object('id',target,'name',coalesce(nullif(e->>'name',''),sender),'stage','new','source',coalesce(e#>>'{provenance,source}',e->>'source'),
       'phone',case when position('@' in sender)=0 then sender else null end,'email',case when position('@' in sender)>0 then sender else null end,
       'createdAt',coalesce(e->>'occurredAt',now()::text),'inboundMessage',e->>'body','inboundId',e->>'inboundId',
       'interactionProvenance',jsonb_build_object('firstTouch',p_id,'latestTouch',p_id,'convertingTouch',p_id));
     insert into crm_leads(id,data,updated_at,deleted) values(target,lead_data,now(),false);
   end if;
 end if;
 insert into crm_interaction_classifications(interaction_id,classification,reviewer_id,supersedes,lead_id)
 values(p_id,p_classification,p_reviewer,previous.id,target) returning id into next_id;
 if target is not null then
   insert into crm_interaction_links(interaction_id,lead_id) values(p_id,target) on conflict do nothing;
   update crm_leads set data=data||jsonb_build_object('commercialDisposition',disposition,'commercialClassificationId',next_id),updated_at=now() where id=target;
   if p_promote then
     update crm_leads set data=jsonb_set(data,'{interactionProvenance}',coalesce(data->'interactionProvenance','{}')||jsonb_build_object('convertingTouch',coalesce(data#>>'{interactionProvenance,convertingTouch}',p_id))) where id=target;
   end if;
 end if;
 return jsonb_build_object('id',next_id,'leadId',target,'classification',p_classification);
end $$;

-- A stale whole-document CRM save must not undo a reviewed correction.
create or replace function public.crm_preserve_commercial_classification() returns trigger language plpgsql as $$
declare decision crm_interaction_classifications; first_id text; latest_id text;
begin
 select * into decision from public.crm_interaction_classifications where lead_id=new.id order by id desc limit 1;
 new.data:=new.data||jsonb_build_object('commercialDisposition',coalesce(decision.classification->>'disposition','lead_candidate'),'commercialClassificationId',decision.id);
 select l.interaction_id into first_id from public.crm_interaction_links l join public.crm_interactions i on i.id=l.interaction_id where l.lead_id=new.id order by coalesce(i.event->>'occurredAt',i.received_at::text),i.id limit 1;
 select l.interaction_id into latest_id from public.crm_interaction_links l join public.crm_interactions i on i.id=l.interaction_id where l.lead_id=new.id order by coalesce(i.event->>'occurredAt',i.received_at::text) desc,i.id desc limit 1;
 if first_id is not null then
   new.data:=jsonb_set(new.data,'{interactionProvenance}',coalesce(new.data->'interactionProvenance','{}')||jsonb_build_object('firstTouch',first_id,'latestTouch',latest_id));
 end if;
 if tg_op='UPDATE' and old.data#>>'{interactionProvenance,convertingTouch}' is not null then
   new.data:=jsonb_set(new.data,'{interactionProvenance,convertingTouch}',old.data#>'{interactionProvenance,convertingTouch}');
 end if;
 return new;
end $$;
create trigger crm_preserve_commercial_classification before insert or update on public.crm_leads for each row execute function public.crm_preserve_commercial_classification();
update public.crm_leads set data=data; -- apply conservative classification; retain every record

revoke all on function public.capture_crm_interaction(text,jsonb,jsonb),public.review_crm_interaction(text,bigint,jsonb,text,boolean),public.crm_capture_inbound_snapshot() from public,anon,authenticated;
grant execute on function public.capture_crm_interaction(text,jsonb,jsonb),public.review_crm_interaction(text,bigint,jsonb,text,boolean) to service_role;

-- Each touch keeps its original structured provenance; the lead stores references.
create or replace function public.crm_update_touch_provenance() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare first_id text; latest_id text;
begin
 select l.interaction_id into first_id from crm_interaction_links l join crm_interactions i on i.id=l.interaction_id where l.lead_id=new.lead_id order by i.received_at,i.id limit 1;
 select l.interaction_id into latest_id from crm_interaction_links l join crm_interactions i on i.id=l.interaction_id where l.lead_id=new.lead_id order by i.received_at desc,i.id desc limit 1;
 update crm_leads set data=jsonb_set(data,'{interactionProvenance}',coalesce(data->'interactionProvenance','{}')||jsonb_build_object('firstTouch',first_id,'latestTouch',latest_id)) where id=new.lead_id;
 return new;
end $$;
create trigger crm_touch_provenance after insert on public.crm_interaction_links for each row execute function public.crm_update_touch_provenance();
revoke all on function public.crm_update_touch_provenance(),public.crm_preserve_commercial_classification(),public.crm_deny_history_mutation() from public,anon,authenticated;
notify pgrst, 'reload schema';
