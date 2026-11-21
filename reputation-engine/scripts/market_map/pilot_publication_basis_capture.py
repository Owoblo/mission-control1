"""Capture bounded official publication/contact/policy evidence for reviewed pilot16."""
import concurrent.futures
import hashlib
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urljoin, urlsplit
from .transport import Transport
from .pilot_source_refresh import Page

ROOT=Path(__file__).resolve().parents[2]/'artifacts/partnership-pilot-3000-20261027'
OUT=ROOT/'publication-basis-16'

def inspect(row):
    domain=urlsplit(row['sources'][0]['url']).hostname.removeprefix('www.')
    hosts={domain,'www.'+domain}
    transport=Transport(max_requests=25,max_bytes=10000000,max_response_bytes=2500000,timeout=12,min_interval=.5,retries=0,allowed_hosts=hosts)
    urls=list(dict.fromkeys([x['url'] for x in row['sources']]+['https://'+domain+'/']))
    urls.sort(key=lambda u:(not bool(re.search('contact|quote',u,re.I)),not bool(re.search('privacy|terms|legal|disclaimer',u,re.I))))
    pages=[];seen=set();target=row['email'].lower()
    directory=OUT/row['organisation_id'];directory.mkdir(parents=True,exist_ok=True)
    while urls and len(pages)<6:
        url=urls.pop(0)
        normalized=url.split('#')[0]
        if normalized in seen:continue
        seen.add(normalized)
        if (urlsplit(url).hostname or '').lower() not in hosts:continue
        try:
            response=transport.fetch(url);parser=Page();parser.feed(response.text());text=re.sub(r'\s+',' ',' '.join(parser.parts)).strip()
            digest=hashlib.sha256(response.body).hexdigest()
            (directory/(digest+'.html')).write_bytes(response.body)
            (directory/(digest+'.txt')).write_text(text)
            email_links=[link for link in parser.links if link.lower().startswith('mailto:') and target in link.lower()]
            pos=text.lower().find(target)
            obfuscated=target.replace('@',' at ').replace('.',' dot ')
            obpos=text.lower().find(obfuscated)
            htmlpos=response.text().lower().find(target)
            pattern=r'unsolicited|solicit|spam|commercial (?:electronic|email|message)|marketing (?:email|message)|do not contact|don.t contact|no (?:email|marketing|advertising)|third.part(?:y|ies)|consent'
            signals=[text[max(0,m.start()-180):m.end()+350] for m in re.finditer(pattern,text,re.I)]
            pages.append({'url':response.url,'requested_url':url,'status':response.status,'sha256':digest,'text_file':str(directory/(digest+'.txt')),
             'email_visible':pos>=0,'email_mailto':bool(email_links),'email_obfuscated_visible':obpos>=0,'mailto_targets':email_links,
             'publication_excerpt':text[max(0,pos-160):pos+len(target)+180] if pos>=0 else text[max(0,obpos-160):obpos+len(obfuscated)+180] if obpos>=0 else None,
             'publication_html_excerpt':response.text()[max(0,htmlpos-180):htmlpos+len(target)+180] if htmlpos>=0 else None,
             'policy_related_snippets':signals,'title_excerpt':text[:250]})
            links=[urljoin(response.url,x).split('#')[0] for x in parser.links if re.search('privacy|terms|legal|disclaimer|anti.?spam',x,re.I)]
            for link in links:
                if (urlsplit(link).hostname or '').lower() in hosts and link not in urls and link not in seen:urls.insert(0,link)
        except Exception as exc:
            pages.append({'requested_url':url,'error':type(exc).__name__,'detail':str(exc)[:250]})
    result={'organisation_id':row['organisation_id'],'organisation_name':row['organisation_name'],'email':row['email'],'captured_at':datetime.now(timezone.utc).isoformat(),'pages':pages,'scope':'Up to six official publication/contact/home/linked-policy pages; no access-control bypass.','metrics':transport.metrics()}
    (directory/'capture.json').write_text(json.dumps(result,indent=2)+'\n')
    return result

def main():
    OUT.mkdir(exist_ok=True)
    rows=[json.loads(l) for l in (ROOT/'practical-fit-source-review-20.jsonl').read_text().splitlines()]
    rows=[r for r in rows if r['identity_email_binding']=='pass' and r['role_relevance']=='pass_for_conditional_context']
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        results=list(pool.map(inspect,rows))
    (OUT/'captures.jsonl').write_text(''.join(json.dumps(r)+'\n' for r in results))
    print(json.dumps({'captured':len(results),'pages':sum(len(r['pages']) for r in results),'error_pages':sum(bool(p.get('error')) for r in results for p in r['pages'])}))

if __name__=='__main__':main()
