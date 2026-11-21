// DNS-only preflight. No email, SMTP probes, paid verification or CRM mutations.
import fs from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {Resolver} from 'node:dns/promises';
const dir='partnership-system/markets/ca/on/windsor-essex/runs/2026-09-15';
const routes=JSON.parse(execFileSync('python3',['-c','import csv,json,sys; print(json.dumps(list(csv.DictReader(open(sys.argv[1])))))',`${dir}/deduplicated-email-routes.csv`],{encoding:'utf8'}));
const resolver=new Resolver({timeout:4000,tries:2});
const domains=[...new Set(routes.map(r=>r.email.toLowerCase().split('@')[1]))];
let cursor=0;const results={};
async function worker(){while(cursor<domains.length){const domain=domains[cursor++];try{const mx=await resolver.resolveMx(domain);results[domain]={status:mx.some(x=>x.exchange&&x.exchange!=='.')?'mail_routing_found':'null_or_empty_mx',mx};}catch(e){results[domain]={status:['ENODATA','ENOTFOUND'].includes(e.code)?'no_mx_needs_domain_review':'dns_lookup_inconclusive',error:e.code};}}}
await Promise.all(Array.from({length:8},worker));
const rows=routes.map(r=>({...r,domain_check:results[r.email.toLowerCase().split('@')[1]].status,mailbox_status:'not_verified',checked_at:new Date().toISOString(),next_action:results[r.email.toLowerCase().split('@')[1]].status==='mail_routing_found'?'verify_current_role_source_and_mailbox':'review_domain_and_find_current_official_contact',send_ready:false}));
const counts={};for(const d of Object.values(results))counts[d.status]=(counts[d.status]||0)+1;
await fs.mkdir(`${dir}/email-verification`,{recursive:true});
await fs.writeFile(`${dir}/email-verification/domain-checks.json`,JSON.stringify({checked_at:new Date().toISOString(),counts,domains:results},null,2));
await fs.writeFile(`${dir}/email-verification/contact-review-queue.json`,JSON.stringify(rows,null,2));
console.log(JSON.stringify({domains:domains.length,account_email_routes:rows.length,unique_emails:new Set(rows.map(r=>r.email.toLowerCase())).size,counts,mailboxes_verified:0,messages_sent:0}));
