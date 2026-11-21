"""Separate raw-intake lane for western company/trade membership rosters.

Existing promotion modules remain code-frozen during pinned consolidation.
This module only stages public source/control/rights receipts; no MAIN access,
person contact extraction, outreach, paid services or access bypass.
"""
from __future__ import annotations
import argparse
import gzip
import hashlib
import json
import re
import uuid
from pathlib import Path
from urllib.parse import urljoin,urlsplit
from lxml import html
from .spatial_context import _save,_hash,_require_space
from .store import stamp
from .transport import Transport,SourceBlocked,BudgetExceeded
from .regional_west import record_operation

SEEDS=[{'id':'wrhba-published-member-rosters','url':'https://wrhba.com/pages/find','area':'WKG','labels':['Kitchener','Waterloo','Cambridge'],
    'publisher':'Waterloo Region Home Builders Association'},
    {'id':'lhba-published-builder-roster','url':'https://lhba.on.ca/members/members-builders/','area':'london','labels':['London'],
    'publisher':'London Home Builders Association'}]


def transport_for(folder):
    declaration={'max_requests':100,'max_body_bytes':30000000,'max_response_bytes':5000000,'min_free_bytes':2147483648,
        'min_interval_seconds':.5,'scope':'Exact public western trade-association rosters and their explicitly linked policies/controls, not company websites or named-person enrichment.'}
    _save(Path(folder)/'declared-inspection-budget.json',declaration)
    return Transport(max_requests=100,max_bytes=30000000,max_response_bytes=5000000,timeout=25,min_interval=.5,retries=1,
        allowed_hosts=['wrhba.com','www.wrhba.com','lhba.on.ca','www.lhba.on.ca'])


def save_response(output,sid,response):
    path=Path(output)/(sid+'.private.html.gz')
    with path.open('wb') as dest:
        with gzip.GzipFile(filename='',fileobj=dest,mode='wb',mtime=0) as stream:stream.write(response.body)
    path.chmod(0o600)
    document=html.fromstring(response.body,parser=html.HTMLParser(encoding='utf-8'))
    for script in document.xpath('//script|//style|//noscript'):script.drop_tree()
    text=' '.join(' '.join(document.itertext()).split());links=[]
    for anchor in document.xpath('//a[@href]'):
        url=urljoin(response.url,anchor.get('href'));label=' '.join(anchor.itertext()).strip()
        if any(word in (url+' '+label).lower() for word in ['privacy','terms','policy','builder','renov','supplier','manufacturer','associate','professional-services','trade-contractor','government','financial-services']):
            links.append({'source_url':url,'label':label})
    return {'file':path.name,'gzip_sha256':_hash(path),'source_body_sha256':hashlib.sha256(response.body).hexdigest(),
        'bytes':len(response.body),'response_url':response.url,'checked_at':stamp(),'document_title':' '.join(document.xpath('//title/text()')),
        'actual_relevant_links':links,'rights_keyword_leads':[text[max(0,m.start()-120):m.end()+220] for m in re.finditer(r'non-commercial|personal use|commercial purposes|reproduc|automated|scraping|prohibited|express permission|copyright',text,re.I)][:40],
        'company_facts_structured':0,'person_names_emails_biographies_media_structured':False}


def inspect_trade_sources(root):
    root=Path(root);output=root/'trade-roster-acquisition';output.mkdir(parents=True,exist_ok=True)
    held=held_disposition(output)
    if held:return held
    transport=transport_for(output);records=[]
    try:
        for seed in SEEDS:
            receipt={'source_id':seed['id'],'source_url':seed['url'],'publisher':seed['publisher'],'rights_status':'exact_linked_policy_review_pending'}
            try:
                _require_space(output,2147483648);response=transport.fetch(seed['url']);receipt.update(save_response(output,seed['id'],response),status='source_identified')
            except (SourceBlocked,BudgetExceeded) as error:receipt.update(status='blocked',error=str(error),checked_at=stamp(),company_facts_structured=0)
            records.append(receipt);_save(output/'entrypoint-review.json',records)
            record_operation(root,source_id=seed['id'],area=seed['area'],family='installer_renovator_directory',url=seed['url'],status=receipt['status'],configured_labels=seed['labels'],
                publisher=seed['publisher'],rights_status=receipt['rights_status'],acquired_raw_rows=0,record_unit='public trade-association source/control metadata',block_reason=receipt.get('error'),
                artifact_paths=['trade-roster-acquisition/entrypoint-review.json'],next_action='Read exact publisher terms and separate company facts from named-person contact fields; then exhaust eligible member rosters/category appearances, not a city/industry census.')
            print(json.dumps({'source':seed['id'],'status':receipt['status'],'bytes':receipt.get('bytes'),'source_links':len(receipt.get('actual_relevant_links',[])),'error':receipt.get('error')}),flush=True)
    finally:_save(output/('inspection-'+str(uuid.uuid4())+'-metrics.json'),transport.metrics())
    return {'source_receipts':len(records),'company_facts_structured':0,'main_database_access':False,'existing_promotion_modules_modified':False}


def inspect_linked_trade_controls(root):
    root=Path(root);output=root/'trade-roster-acquisition'
    held=held_disposition(output)
    if held:return held
    transport=transport_for(output);entries=json.loads((output/'entrypoint-review.json').read_text());records=[]
    try:
        for entry in entries:
            if entry['status']=='blocked':continue
            seed=next(s for s in SEEDS if s['id']==entry['source_id']);urls=[]
            for link in entry['actual_relevant_links']:
                parts=urlsplit(link['source_url'])
                if parts.hostname not in [urlsplit(seed['url']).hostname,'www.'+urlsplit(seed['url']).hostname]:continue
                if any(word in (parts.path+' '+link['label']).lower() for word in ['privacy','terms','policy']):urls.append(link['source_url'])
                elif seed['id'].startswith('wrhba') and parts.path.startswith('/pages/') and any(word in parts.path for word in ['builders-and','renov','supplier','manufacturer','trade-contractor','professional-services','government','financial-services']):urls.append(link['source_url'])
                elif seed['id'].startswith('lhba') and parts.path.startswith('/members/members-'):urls.append(link['source_url'])
            # Inspect exact linked policies before any additional roster views.
            urls=sorted(dict.fromkeys(urls),key=lambda u:(not any(w in urlsplit(u).path.lower() for w in ['terms','privacy','policy']),u))
            for index,url in enumerate(urls,1):
                sid=seed['id']+'-linked-'+str(index);receipt={'source_id':sid,'publisher_source':seed['id'],'source_url':url,'company_facts_structured':0}
                try:
                    _require_space(output,2147483648);response=transport.fetch(url);receipt.update(save_response(output,sid,response),status='source_reviewed',rights_status='exact_source_notice_review_pending')
                except (SourceBlocked,BudgetExceeded) as error:receipt.update(status='blocked',error=str(error),checked_at=stamp(),rights_status='access_policy_unresolved')
                records.append(receipt);_save(output/'linked-control-and-policy-review.json',records)
                record_operation(root,source_id=sid,area=seed['area'],family='installer_renovator_directory',url=url,status=receipt['status'],configured_labels=seed['labels'],
                    rights_status=receipt['rights_status'],acquired_raw_rows=0,record_unit='source-linked association roster/policy metadata',block_reason=receipt.get('error'),
                    artifact_paths=['trade-roster-acquisition/linked-control-and-policy-review.json'],next_action='Review all explicit reuse/access constraints before selecting only company factual fields; no named-person/email/media extraction or supplier-to-SSM inference.')
                print(json.dumps({'source':sid,'status':receipt['status'],'bytes':receipt.get('bytes'),'policy_leads':len(receipt.get('rights_keyword_leads',[])),'error':receipt.get('error')}),flush=True)
    finally:_save(output/('linked-controls-'+str(uuid.uuid4())+'-metrics.json'),transport.metrics())
    return {'linked_receipts':len(records),'company_facts_structured':0,'main_database_access':False,'existing_promotion_modules_modified':False}


def held_disposition(output):
    path=Path(output)/'manifest.json'
    if path.exists():
        result=json.loads(path.read_text())
        if result.get('no_further_access_to_these_routes'):
            return {**result,'held_snapshot_reused':True,'fresh_http_requests':0}
    return None


def review_recorded_trade_rights(root):
    """No requests: record the exact discovered restrictions and stop intake."""
    root=Path(root);output=root/'trade-roster-acquisition';records=json.loads((output/'linked-control-and-policy-review.json').read_text());holds=[]
    specifications=[('wrhba-published-member-rosters','https://wrhba.com/policies/terms-of-service','WKG',['Kitchener','Waterloo','Cambridge'],
        'WRHBA terms apply to all browsers and website information and forbid copying/reproducing/exploiting Service or website contacts without express written permission.',
        ['You agree not to reproduce, duplicate, copy','any contact on the website','without express written permission']),
        ('lhba-published-builder-roster','https://lhba.on.ca/terms-of-use/','london',['London'],
        'LHBA terms expressly prohibit automated/robot website access for any purpose, manual copying without prior written consent, and commercial use.',
        ['Use any robot, spider, or other automatic device','personal, non-commercial use only','You must not access or use for any commercial purposes'])]
    for sid,url,area,labels,reason,patterns in specifications:
        receipt=next(r for r in records if r['source_url']==url);path=output/receipt['file']
        if _hash(path)!=receipt['gzip_sha256']:raise SourceBlocked('Trade source exact policy receipt checksum differs')
        with gzip.open(path,'rb') as handle:body=handle.read()
        if hashlib.sha256(body).hexdigest()!=receipt['source_body_sha256']:raise SourceBlocked('Trade source exact policy original body hash differs')
        document=html.fromstring(body,parser=html.HTMLParser(encoding='utf-8'))
        for node in document.xpath('//script|//style|//noscript'):node.drop_tree()
        text=' '.join(' '.join(document.itertext()).split())
        if not all(pattern in text for pattern in patterns):raise SourceBlocked('Expected trade source restriction text differs; no guessed policy disposition')
        holds.append({'source_id':sid,'source_url':next(seed['url'] for seed in SEEDS if seed['id']==sid),
            'retrieval_status':'restricted','rights_status':'permission_required','latest_recorded_error':reason,
            'observation_reference':'trade-roster-acquisition/linked-control-and-policy-review.json#'+receipt['source_id'],
            'policy_url':url,'policy_gzip_sha256':receipt['gzip_sha256'],'policy_source_body_sha256':receipt['source_body_sha256'],
            'permitted_next_step':'Obtain applicable publisher permission or an independently licensed export before acquisition. Manual copying/upload alone is not a reuse grant; no messages sent.',
            'company_factual_records_normalised':0,'named_person_contact_records_created':0,'source_inventory_exhausted':False})
        record_operation(root,source_id=sid,area=area,family='installer_renovator_directory',url=holds[-1]['source_url'],status='permission_required',configured_labels=labels,
            rights_status='permission_required',rights_evidence_urls=[url],acquired_raw_rows=0,record_unit='unretrieved/unnormalised restricted company roster',
            block_reason=reason,source_inventory_exhausted=False,artifact_paths=['trade-roster-acquisition/rights-review-and-holds.json'],
            next_action='Stop this publisher route; no new roster/profile/API fetches or commercial factual normalisation absent applicable permission. Continue independent source families.')
    _save(output/'rights-review-and-holds.json',holds)
    from .civic_sources import write_blocked_source_handoff
    write_blocked_source_handoff(output,holds)
    report={'status':'both_sources_held_at_exact_policy_review','sources_inspected':2,'company_factual_records_normalised':0,'source_inventory_exhausted':False,
        'policy_receipts_verified':len(holds),'market_completeness_verified':False,'main_database_access':False,'existing_promotion_modules_modified':False,
        'rights_handoff':'trade-roster-acquisition/blocked-source-handoff.csv','no_further_access_to_these_routes':True}
    _save(output/'manifest.json',report);return report


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--output',type=Path,required=True);parser.add_argument('--inspect',action='store_true');parser.add_argument('--linked-controls',action='store_true');parser.add_argument('--review-recorded-rights',action='store_true');args=parser.parse_args()
    if args.inspect:result=inspect_trade_sources(args.output)
    elif args.linked_controls:result=inspect_linked_trade_controls(args.output)
    elif args.review_recorded_rights:result=review_recorded_trade_rights(args.output)
    else:parser.error('Select an explicit source/control inspection action')
    print(json.dumps(result),flush=True)


if __name__=='__main__':main()
