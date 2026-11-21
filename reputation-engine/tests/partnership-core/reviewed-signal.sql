-- Run in a transaction and roll back. No external sends.
do $$
declare a uuid; c uuid; task_id text; task_snapshot jsonb; ev jsonb; r jsonb; k text;
begin
 insert into partner_companies(company_name,normalized_key) values('Signal regression',gen_random_uuid()::text) returning id into a;
 insert into market_contacts(name,partner_company_id,city,email) values('Signal test',a,'Ottawa','signal@example.test') returning id into c;
 insert into crm_tasks(id,title,status,category,priority,related_type,related_id,source) values(gen_random_uuid(),'Physical letter','open','partnership_print_delivery','normal','relationship',c::text,'manual') returning id into task_id;
 select to_jsonb(t) into task_snapshot from crm_tasks t where id=task_id;
 k:='signal-regression-'||a;
 ev:=jsonb_build_object('marketActive',true,'serviceAvailable',true,'channelEligible',true,'senderHealthy',true,'observedAt',now(),'sender','Dr. Courage | Dexa Movers <hello@dexamovers.ca>','contentHash','reviewed-body');
 r:=reserve_partnership_action(c,'email','cold_introduction',k,ev);
 if not (r->'reasons' ? 'account_tasks_pending') then raise exception 'Task without review must block: %',r; end if;
 insert into partnership_policy_events(event_key,account_id,action_key,event_type,evidence) values('signal-review:'||k,a,k,'signal_introduction.reviewed',jsonb_build_object('contact_id',c,'channel','email','recipient','signal@example.test','sender',ev->>'sender','content_hash','reviewed-body','reviewed_by','fixture','source_url','https://example.test/news','expires_at',now()+interval '1 hour','reviewed_tasks',jsonb_build_array(task_snapshot)));
 r:=reserve_partnership_action(c,'email','cold_introduction',k,jsonb_set(ev,'{contentHash}','"changed"'));
 if not (r->'reasons' ? 'account_tasks_pending') then raise exception 'Changed content bypassed review'; end if;
 update crm_tasks set description='New unreviewed work' where id=task_id;
 r:=reserve_partnership_action(c,'email','cold_introduction',k,ev);
 if not (r->'reasons' ? 'account_tasks_pending') then raise exception 'Changed task bypassed review'; end if;
 select to_jsonb(t) into task_snapshot from crm_tasks t where id=task_id;
 k:=k||'-new-review';
 insert into partnership_policy_events(event_key,account_id,action_key,event_type,evidence) values('signal-review:'||k,a,k,'signal_introduction.reviewed',jsonb_build_object('contact_id',c,'channel','email','recipient','signal@example.test','sender',ev->>'sender','content_hash','reviewed-body','reviewed_by','fixture','source_url','https://example.test/news','expires_at',now()+interval '1 hour','reviewed_tasks',jsonb_build_array(task_snapshot)));
 r:=reserve_partnership_action(c,'email','cold_introduction',k,ev);
 if not (r->>'allowed')::boolean then raise exception 'Reviewed email rejected: %',r; end if;
 if not exists(select 1 from crm_tasks where id=task_id and status='open') then raise exception 'Email changed physical-mail state'; end if;
 r:=reserve_partnership_action(c,'email','cold_introduction',k,ev);
 if not (r->'reasons' ? 'existing_reservation_inspect_before_retry') then raise exception 'Duplicate allowed'; end if;
end $$;
