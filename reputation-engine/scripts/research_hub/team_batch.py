"""Parse a captured brokerage team page once; reuse explicit Person graph edges."""
import argparse
import datetime as dt
import gzip
import hashlib
import html
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import urllib.request
import urllib.parse

from scripts.market_map.structured_contacts import walk_contact_graph
from scripts.market_map.contact_normalization import parse_email_candidate, parse_phone_candidate
from scripts.research_hub.directory import Directory, norm, phone_key, saved_routes
from scripts.research_hub.listings import atomic

TEAM_URL='https://www.unioncapitalrealty.ca/team'


def refresh_captured_batch(folder):
    """One reviewed publisher, daily; failures retain prior evidence and its date."""
    folder=Path(folder);folder.mkdir(parents=True,exist_ok=True)
    current=dt.datetime.now(dt.timezone.utc)
    report_path=folder/'batch-refresh.json'
    if report_path.exists():
        report=json.loads(report_path.read_text())
        attempted=dt.datetime.fromisoformat(report['attempted_at'])
        if (current-attempted).total_seconds() < (86400 if report['state']=='captured' else 3600):return report
    report={'attempted_at':current.isoformat(),'source_url':TEAM_URL,'model_requests':0}
    class SameHostRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self,req,fp,code,msg,headers,newurl):
            target=urllib.parse.urlsplit(newurl)
            if target.scheme!='https' or target.hostname!='www.unioncapitalrealty.ca':
                raise ValueError('Publisher redirect needs review')
            return super().redirect_request(req,fp,code,msg,headers,newurl)
    try:
        request=urllib.request.Request(TEAM_URL,headers={'User-Agent':'SaturnResearch/1.0'})
        with urllib.request.build_opener(SameHostRedirect()).open(request,timeout=30) as response:
            body=response.read(8_000_001)
        if len(body)>8_000_000:raise ValueError('Source size limit')
        result=extract(body,TEAM_URL,current.isoformat(),'UNION CAPITAL REALTY',Directory())
        if not result['summary']['people_with_routes']:raise ValueError('Source structure changed or empty')
        source_dir=folder/'sources';source_dir.mkdir(exist_ok=True)
        (source_dir/(result['summary']['source_sha256']+'.html.gz')).write_bytes(gzip.compress(body))
        atomic(folder/'batch.json',result)
        report.update(state='captured',summary=result['summary'])
    except Exception as exc:
        report.update(state='source_error_prior_evidence_retained',error=type(exc).__name__)
    atomic(report_path,report)
    return report


class GraphScripts(HTMLParser):
    def __init__(self):
        super().__init__(); self.active=False; self.buffer=''; self.graphs=[]

    def handle_starttag(self, tag, attrs):
        if tag=='script' and dict(attrs).get('type')=='application/ld+json':
            self.active=True; self.buffer=''

    def handle_data(self, data):
        if self.active:self.buffer+=data

    def handle_endtag(self, tag):
        if tag=='script' and self.active:
            try:self.graphs.append(json.loads(self.buffer))
            except ValueError:pass
            self.active=False


def pointer_value(value, pointer):
    for part in pointer.split('/')[1:]:
        part=part.replace('~1','/').replace('~0','~')
        value=value[int(part)] if isinstance(value,list) else value[part]
    return value


def brokerage_key(value):
    return norm(re.sub(r'[,\s]+brokerage\s*$', '', value or '', flags=re.I))


def extract(body, source_url, captured_at, brokerage, directory):
    parser=GraphScripts();parser.feed(body.decode('utf-8',errors='replace'))
    sha=hashlib.sha256(body).hexdigest();rows=[];seen=set()
    for script_index, graph in enumerate(parser.graphs):
        for item in walk_contact_graph(graph):
            if item['channel']!='person' or item['ambiguity_review_required'] or item['excluded_context']:
                continue
            employers=item['candidate_employers']
            if len(employers)!=1 or brokerage_key(employers[0].get('name'))!=brokerage_key(brokerage):
                continue
            person=pointer_value(graph,item['node_pointer']);name=person.get('name')
            match=directory.match({'name':name,'brokerage':brokerage})
            identity=match['identities'][0] if match['state']=='existing_directory_candidate' else None
            previous=saved_routes(match['observations'])
            text=html.unescape(str(person.get('description') or ''))
            phones=re.findall(r'(?<!\d)(?:\+?1[ .-]?)?\(?[2-9]\d{2}\)?[ .-]*[2-9]\d{2}[ .-]*\d{4}(?!\d)',text)
            emails=[token.strip('.,;') for token in text.split() if '@' in token]
            if isinstance(person.get('telephone'),str):phones.append(person['telephone'])
            if isinstance(person.get('email'),str):emails.append(person['email'])
            for kind, values in [('phone',phones),('email',emails)]:
                for raw in values:
                    value=parse_phone_candidate(raw).get('e164') if kind=='phone' else parse_email_candidate(raw).get('email')
                    if not value:continue
                    key=(norm(name),kind,value)
                    if key in seen:continue
                    seen.add(key)
                    if kind=='phone':
                        owners=directory.phone_owners.get(phone_key(value),set())
                        shared=bool(owners-{identity})
                        saved=bool(identity and phone_key(value) in previous['phones'])
                    else:
                        shared=False
                        saved=value.lower() in previous['emails']
                    rows.append({'name':name,'brokerage':brokerage,'identity':identity,'directory_match':match['state'],
                                 'kind':kind,'value':value,'already_saved_for_agent':saved,
                                 'shared_in_saved_directory':shared,'source_url':source_url,
                                 'captured_at':captured_at,'source_sha256':sha,
                                 'evidence_pointer':f'ld_json[{script_index}]'+item['node_pointer'],
                                 'evidence_state':'captured_person_and_employer_association',
                                 'ownership_verified':False,'deliverability_verified':False,'outreach_eligible':False})
    # A number repeated across people on this very page also cannot be personal.
    people_by_phone={}
    for row in rows:
        if row['kind']=='phone':people_by_phone.setdefault(row['value'],set()).add(norm(row['name']))
    for row in rows:
        if row['kind']=='phone' and len(people_by_phone[row['value']])>1:row['shared_on_source_page']=True
        else:row['shared_on_source_page']=False
    summary={'people_with_routes':len({norm(r['name']) for r in rows}),
             'matched_directory_identities':len({r['identity'] for r in rows if r['identity']}),
             'names_needing_identity_review':len({norm(r['name']) for r in rows if r['directory_match']=='identity_review'}),
             'names_not_found_in_directory':len({norm(r['name']) for r in rows if r['directory_match']=='no_directory_match'}),
             'new_phone_candidates':sum(r['kind']=='phone' and not r['already_saved_for_agent'] and not r['shared_in_saved_directory'] and not r['shared_on_source_page'] for r in rows),
             'new_email_candidates':sum(r['kind']=='email' and not r['already_saved_for_agent'] for r in rows),
             'new_phone_candidates_for_matched_people':sum(r['identity'] is not None and r['kind']=='phone' and not r['already_saved_for_agent'] and not r['shared_in_saved_directory'] and not r['shared_on_source_page'] for r in rows),
             'new_email_candidates_for_matched_people':sum(r['identity'] is not None and r['kind']=='email' and not r['already_saved_for_agent'] for r in rows),
             'model_requests':0,'source_sha256':sha,'source_url':source_url,'captured_at':captured_at}
    return {'summary':summary,'candidates':rows}


def main():
    p=argparse.ArgumentParser();p.add_argument('--html',required=True);p.add_argument('--url',required=True)
    p.add_argument('--captured-at',required=True);p.add_argument('--brokerage',required=True)
    p.add_argument('--directory');p.add_argument('--output',required=True);a=p.parse_args()
    result=extract(Path(a.html).read_bytes(),a.url,a.captured_at,a.brokerage,Directory(a.directory))
    atomic(a.output,result);print(json.dumps(result['summary']))


if __name__=='__main__':main()
