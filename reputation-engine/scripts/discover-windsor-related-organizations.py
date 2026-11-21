"""Extract public external-domain leads; does not infer endorsement or send."""
import json,csv,urllib.parse,re,hashlib
from pathlib import Path
P=Path('partnership-system/markets/ca/on/windsor-essex/runs/2026-09-15');E=P/'expansion';S=P/'send-release'
rows=[]
for path in [E/'company-site-reviews.jsonl',S/'company-publication-deep-review.jsonl',S/'company-publication-retry-review.jsonl',S/'company-contact-deeper-review.jsonl']:
 if path.exists():rows+=list(map(json.loads,path.read_text().splitlines()))
excluded={'facebook.com','instagram.com','twitter.com','x.com','youtube.com','youtu.be','linkedin.com','google.com','google.ca','goo.gl','g.page','maps.app.goo.gl','wix.com','wixsite.com','wordpress.com','wordpress.org','godaddy.com','shopify.com','myshopify.com','squarespace.com','microsoft.com','apple.com','adobe.com','cloudflare.com','doubleclick.net','recaptcha.net','gstatic.com','fonts.googleapis.com','pinterest.com','tiktok.com','vimeo.com','amazon.com','whatsapp.com','wa.me','schema.org','w3.org','mozilla.org','bootstrapmade.com'}
def host(u):return (urllib.parse.urlsplit(u).hostname or '').lower().removeprefix('www.')
edges={}
for r in rows:
 for p in r.get('pages',[]):
  source=host(p['resolved_url'])
  for link in p.get('links',[]):
   u=urllib.parse.urljoin(p['resolved_url'],link);target=host(u)
   if not u.startswith(('http://','https://')) or not target or target==source or target.endswith('.'+source) or source.endswith('.'+target) or any(target==d or target.endswith('.'+d) for d in excluded):continue
   key=(source,target)
   if key not in edges:edges[key]={'source_organization':r.get('name',r.get('account_name','')),'source_domain':source,'candidate_domain':target,'candidate_url':u,'evidence_url':p['resolved_url'],'relationship_type':'external_link_unclassified','verification_status':'research_required_not_a_referral','geography':'unknown','next_action':'Identify organization and link context; confirm client/supplier/partner relation and local relevance before outreach'}
rows=list(edges.values())
with (E/'related-organization-candidates.csv').open('w',newline='') as f:
 if rows:w=csv.DictWriter(f,fieldnames=list(rows[0]));w.writeheader();w.writerows(rows)
print(json.dumps({'source_target_edges':len(rows),'candidate_domains':len({r['candidate_domain'] for r in rows}),'outreach_sent':0,'relationships_verified':0}))
