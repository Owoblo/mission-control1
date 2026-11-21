"""Prepare remaining basic candidates using existing sector copy and explicit research holds."""
import ast,json,hashlib,re
from partnership_localization import location_line
from pathlib import Path
p=Path('partnership-system/markets/ca/on/windsor-kitchener/runs/2026-09-15');q=p/'contact-qualification'
# Reuse only pure sector rules and copy; never execute the older batch script.
module=ast.parse(Path('scripts/prepare-corridor-release.py').read_text());nodes=[n for n in module.body if isinstance(n,ast.FunctionDef) and n.name=='sector' or isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id in ('services','hold_emails') for t in n.targets)];ns={'re':re};exec(compile(ast.Module(body=nodes,type_ignores=[]),'sector_copy','exec'),ns)
routes=json.loads((q/'routes.json').read_text());assess={r['route_id']:r for r in json.loads((q/'assessments.json').read_text())};reviews={r['id']:r for r in map(json.loads,(p/'company-site-reviews.jsonl').read_text().splitlines())};validation={r['email']:r for r in map(json.loads,Path('partnership-system/markets/ca/on/windsor-essex/runs/2026-09-15/email-verification/aws-validation-results.jsonl').read_text().splitlines())}
rows=[];held=[];seen=set()
for r in routes:
 if assess[r['route_id']]['minimum_status']!='basic_candidate':continue
 domain=r['email'].split('@')[1]
 reason=ns['hold_emails'].get(r['email'])
 if reason:held.append({'email':r['email'],'reason':reason});continue
 if domain in seen:held.append({'email':r['email'],'reason':'one primary introduction per company domain in this batch'});continue
 seen.add(domain);src=reviews[r['source_record_id']];kind=ns['sector']({'name':r['company'],'categories':src.get('categories','')});service,a,b=ns['services'][kind];variant='A' if int(hashlib.sha256(r['route_id'].encode()).hexdigest()[:8],16)%2==0 else 'B'
 opening=location_line(r['city'],r.get('organization_site_supported')) or f"I’m getting in touch about moving support for {r['company']}."
 body='\n\n'.join([f"Hello {r['company']} team,",opening,'I’m John with Saturn Star Movers. '+service,a if variant=='A' else b,'John Owolabi\nSaturn Star Movers\nbusiness@starmovers.ca | (226) 773-2993\n3608 Seminole Street, Unit 3\nWindsor, ON N8Y 1Y4, Canada','If you prefer no further emails from me, just reply and let me know.'])
 subject={'clinic':'Who handles furniture moves at your practice?','design':'The moving part of a workspace fit-out','education':'Who arranges your furniture moves?','property':'Furniture transfers between your properties','moving_partner':'Windsor–Essex overflow moving support'}.get(kind,'A moving contact for '+r['company'])
 rows.append({'id':'minimum-remaining-v1:'+r['route_id'],'account_name':r['company'],'to':r['email'],'recipient_name':r['company']+' — Business contact','recipient_role':'Published business contact — routing inquiry','city':r['city'],'website':r['website'],'source_categories':src.get('categories') or kind,'publication_source':r['publication_url'],'publication_checked_at':r['checked_at'],'context_source':r['website'],'subject':subject,'body':body,'variant':variant,'experiment_id':'minimum-sector-localized-v2','experiment_sector':kind,'experiment_angle':'supplier-route' if variant=='A' else 'current-process','validation':validation.get(r['email']),'sending_basis':{'type':'company_published_email','source':r['publication_url'],'publication_excerpt':r['publication_excerpt'],'role_relevance':kind+' furniture-moving or referral routing question'},'status':'prepared_for_live_send_check'})
(q/'localized-send-release.json').write_text(json.dumps({'initial':rows,'held':held},indent=2));(q/'localized-validation-input.json').write_text(json.dumps([r['to'] for r in rows]));print(json.dumps({'prepared':len(rows),'held':held}))
