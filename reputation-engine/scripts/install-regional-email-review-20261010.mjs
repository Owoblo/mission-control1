import {fs} from './gta-email-recovery-runtime.mjs';
const dir='artifacts/other-region-email-audit-20261010';
const migration=fs.readFileSync('supabase/migrations/20261010000200_reviewed_regional_nonresponse_email.sql','utf8');
const p=JSON.parse(fs.readFileSync(dir+'/candidates.json')).find(p=>!p.category);
const quote=s=>"'"+String(s).replaceAll("'","''")+"'";
const key='owner-email-recovery-regions-20261010:'+p.id+'-test';
const tests=`
update market_contacts set email=${quote(p.email)},email_verification_status='valid',email_verification_provider='aws_ses',email_verification_checked_at=now() where id=${quote(p.id)};
insert into partnership_policy_events(event_key,account_id,action_key,event_type,evidence) values(${quote('nonresponse-review:'+key)},${quote(p.account_id)},${quote(key)},'nonresponse_email.reviewed',jsonb_build_object('contact_id',${quote(p.id)},'recipient',${quote(p.email)},'sender','test-sender','content_hash','test-hash','owner_authorized',true,'context_complete',true,'mailbox_checked',true,'email_validation_status','overall_valid_nonrisky','reviewed_by','Owner-authorized regional regression','source_url','https://go.quote2move.com/marketing/partners','source_sms_touch_id',${quote(p.first_sms_touch_id)},'expires_at',now()+interval '30 minutes','category_reviewed',true,'contact_category',''));
do $test$ declare evidence jsonb:='{"sender":"test-sender","contentHash":"test-hash"}'; result jsonb; begin
if reviewed_nonresponse_email_allowed(${quote(p.id)},'email',${quote(key)},evidence) is not true then raise exception 'Reviewed non-realtor denied'; end if;
if reviewed_nonresponse_email_allowed(${quote(p.id)},'sms',${quote(key)},evidence) is true then raise exception 'Non-email exception'; end if;
if reviewed_nonresponse_email_allowed(${quote(p.id)},'email',${quote(key)},evidence||'{"contentHash":"different"}'::jsonb) is true then raise exception 'Changed content accepted'; end if;
update market_contacts set category='unreviewed-category' where id=${quote(p.id)};
if reviewed_nonresponse_email_allowed(${quote(p.id)},'email',${quote(key)},evidence) is true then raise exception 'Changed category accepted'; end if;
update market_contacts set category=null,last_inbound_at=now() where id=${quote(p.id)};
if reviewed_nonresponse_email_allowed(${quote(p.id)},'email',${quote(key)},evidence) is true then raise exception 'New reply accepted'; end if;
update market_contacts set last_inbound_at=null,email_last_sent_at=now() where id=${quote(p.id)};
if reviewed_nonresponse_email_allowed(${quote(p.id)},'email',${quote(key)},evidence) is true then raise exception 'Prior email accepted'; end if;
update market_contacts set email_last_sent_at=null,do_not_contact=true where id=${quote(p.id)};
result:=reserve_partnership_action(${quote(p.id)},'email','cold_introduction',${quote(key)},evidence||jsonb_build_object('marketActive',true,'serviceAvailable',true,'channelEligible',true,'senderHealthy',true,'observedAt',now()));
if not(result->'reasons' ? 'recipient_suppressed') then raise exception 'Suppression bypassed'; end if;
end $test$;`;
async function sql(query){const r=await fetch('https://api.supabase.com/v1/projects/idbyrtwdeeruiutoukct/database/query',{method:'POST',headers:{Authorization:'Bearer '+process.env.SUPABASE_ACCESS_TOKEN,'Content-Type':'application/json'},body:JSON.stringify({query})});if(!r.ok)throw Error(await r.text());return r.json();}
fs.writeFileSync(dir+'/regional-policy-regression.sql',tests);
await sql('begin;'+migration+tests+'rollback;');console.log('Regional category, content, channel, inbound, prior-email and suppression checks passed; rolled back.');
await sql('begin;'+migration+'commit;');console.log('Scoped regional category review installed.');
