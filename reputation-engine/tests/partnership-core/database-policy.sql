do $$
declare a uuid; c1 uuid; c2 uuid; c3 uuid; result jsonb; ev jsonb;
begin
 insert into public.partner_companies(company_name,normalized_key) values('Policy regression fixture',gen_random_uuid()::text) returning id into a;
 insert into public.market_contacts(name,partner_company_id,city) values('Policy fixture one',a,'Sarnia') returning id into c1;
 insert into public.market_contacts(name,partner_company_id,city) values('Policy fixture two',a,'Sarnia') returning id into c2;
 insert into public.market_contacts(name,partner_company_id,city) values('Policy fixture three',a,'Sarnia') returning id into c3;
 ev:=jsonb_build_object('marketActive',true,'serviceAvailable',true,'channelEligible',true,'senderHealthy',true,'observedAt',now());
 result:=public.reserve_partnership_action(c1,'email','cold_introduction','regression-first-'||a,ev);
 if not (result->>'allowed')::boolean then raise exception 'Initial action rejected: %',result; end if;
 result:=public.reserve_partnership_action(c1,'email','cold_introduction','regression-first-'||a,ev);
 if (result->>'allowed')::boolean then raise exception 'Duplicate action allowed'; end if;
 result:=public.reserve_partnership_action(c2,'sms','cold_introduction','regression-second-'||a,ev);
 if not (result->>'allowed')::boolean then raise exception 'Second recipient rejected: %',result; end if;
 result:=public.reserve_partnership_action(c3,'direct_mail','cold_introduction','regression-third-'||a,ev);
 if (result->>'allowed')::boolean then raise exception 'Cross-channel limit bypassed'; end if;
 update public.market_contacts set last_inbound_at=now() where id=c1;
 result:=public.reserve_partnership_action(c1,'phone','reply','regression-reply-'||a,ev);
 if not (result->>'allowed')::boolean then raise exception 'Reply incorrectly blocked: %',result; end if;
 update public.market_contacts set do_not_contact=true where id=c2;
 result:=public.reserve_partnership_action(c1,'sms','reply','regression-suppression-'||a,ev);
 if (result->>'allowed')::boolean then raise exception 'Account suppression bypassed'; end if;
end $$;
