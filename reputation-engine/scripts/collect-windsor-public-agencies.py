"""Public government site/contact register; no sends. Preserve site versus authority."""
import json,csv,re,urllib.request,concurrent.futures,datetime
from pathlib import Path
from lxml import html
P=Path('partnership-system/markets/ca/on/windsor-essex/runs/2026-09-15/expansion')
sources=[('County of Essex','https://www.countyofessex.ca/contacts-directory/'),('Town of Essex','https://www.essex.ca/contacts-directory/'),('Town of Kingsville','https://www.kingsville.ca/contacts-directory/'),('Town of LaSalle','https://www.lasalle.ca/contacts-directory/'),('Municipality of Lakeshore','https://www.lakeshore.ca/contacts-directory/')]
def clean(s):return re.sub(r'\s+',' ',s).strip()
def read(item):
 name,url=item
 try:
  with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'Mozilla/5.0'}),timeout=20) as r:raw=r.read().decode('utf8',errors='replace')
  x=html.fromstring(raw);rows=[]
  for a in x.xpath('//*[@data-emailaddress]'):
   email=a.get('data-emailaddress');panel=next((p for p in a.iterancestors() if p.get('aria-labelledby')),None)
   if panel is None:continue
   label=x.xpath('//*[@id=$id]',id=panel.get('aria-labelledby'));person=clean(label[0].text_content()) if label else clean(a.text_content())
   paras=[clean(p.text_content()) for p in panel.xpath('.//p')];address=next((p for p in paras if re.search(r'\b[A-Z]\d[A-Z]\s?\d[A-Z]\d\b',p,re.I)),'')
   rows.append({'parent_organization':name,'person_and_role':person,'email':email,'address':address,'source_url':url,'checked_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'status':'published_contact_role_review','target_role':bool(re.search(r'procurement|purchas|facilit|physical resources|maintenance|support services|administrat|chief librarian|general manager',person,re.I))})
  return {'name':name,'url':url,'contacts':rows,'page_text':clean(x.text_content()),'published_emails':sorted(set(x.xpath('//*[@data-emailaddress]/@data-emailaddress')))}
 except Exception as e:return {'name':name,'url':url,'error':str(e),'contacts':[]}
with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:results=list(pool.map(read,sources))
(P/'public-agency-contact-evidence.json').write_text(json.dumps(results,indent=2))
rows=[r for p in results for r in p['contacts']]
if rows:
 with (P/'public-agency-contacts.csv').open('w',newline='') as f:w=csv.DictWriter(f,fieldnames=list(rows[0]));w.writeheader();w.writerows(rows)
print(json.dumps({'contact_records':len(rows),'relevant_role_candidates':sum(r['target_role'] for r in rows),'source_failures':[{r['name']:r.get('error')} for r in results if r.get('error')]}))
