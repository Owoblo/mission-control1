"""Reviewed saved-capture contract. No downloading, permission inference or relabeling."""
import hashlib,json
from datetime import datetime,timezone
from pathlib import Path
from urllib.parse import urlsplit

SCHEMA=1
SECTORS={'realtor_brokerage','property_manager','storage','manufacturing','contractor_service','multi_branch','directory_association'}
DIMENSIONS={'sector':SECTORS,'language':{'en','fr'},'company_scope':{'single','multiple'},
            'source_kind':{'static','rendered','document'},'markup':{'simple','complex','structured'}}

def digest(data):return hashlib.sha256(data).hexdigest()
def canonical(value):return json.dumps(value,sort_keys=True,ensure_ascii=False,separators=(',',':'))
def require(ok,message):
    if not ok:raise ValueError(message)
def local_file(root,name,sha):
    path=(root/name).resolve()
    require(path.is_relative_to(root),'file outside corpus root')
    require(path.is_file() and path.stat().st_size<=20_000_000,'missing/oversize corpus file')
    body=path.read_bytes();require(digest(body)==sha,'file hash mismatch');return body

def load_corpus(manifest_path,*,now=None):
    path=Path(manifest_path).resolve();root=path.parent;m=json.loads(path.read_text());now=now or datetime.now(timezone.utc)
    require(m.get('schema_version')==SCHEMA and m.get('corpus_kind') in {'real','synthetic'},'corpus schema/kind')
    require(bool(m.get('version')) and bool(m.get('label_version')),'versions required')
    labels=json.loads(local_file(root,m['labels_file'],m['labels_sha256']))
    require(isinstance(labels,list),'labels list required')
    pages=m['captures'];ids=[p['id'] for p in pages]
    require(len(ids)==len(set(ids)),'duplicate capture')
    require(len(labels)==len(ids) and {r['id'] for r in labels}==set(ids),'missing/duplicate labels')
    splits={};bodies={};bylabel={r['id']:r for r in labels}
    for page in pages:
        require(page['split'] in {'development','holdout','safety'},'invalid split')
        require(page.get('domain_group') and page.get('template_family'),'reviewed domain and template groups required')
        require(urlsplit(page['url']).scheme in {'http','https'},'source URL required')
        for group in [('domain',page['domain_group']),('template',page['template_family']),('hash',page['sha256'])]+[('business',b) for b in page['business_ids']]:
            require(group not in splits or splits[group]==page['split'],'domain/template/content split leakage')
            splits[group]=page['split']
        for field,choices in DIMENSIONS.items():require(page.get(field) in choices,'missing/invalid stratum '+field)
        require(bool(page.get('business_ids')) and len(page['business_ids'])==len(set(page['business_ids'])),'input businesses required')
        approval=page['permission']
        require(approval.get('owner_approved') is True and approval.get('retention_allowed') is True and approval.get('evaluation_allowed') is True,'source permission missing')
        require(datetime.fromisoformat(approval['retain_until'].replace('Z','+00:00'))>now,'retention expired')
        local_file(root,approval['evidence_file'],approval['evidence_sha256'])
        require(bool(approval.get('approved_by')) and bool(page.get('captured_at')),'approval/capture identity missing')
        datetime.fromisoformat(page['captured_at'].replace('Z','+00:00'))
        bodies[page['id']]=local_file(root,page['file'],page['sha256'])
        gold=bylabel[page['id']];review=gold['review']
        require(gold.get('exhaustive') is True and gold.get('label_version')==m['label_version'],'exhaustive versioned labels required')
        require(len(set(review['annotators']))>=2 and review.get('independent') is True and review.get('adjudicated') is True and bool(review.get('adjudicator')),'independent adjudication required')
        local_file(root,review['evidence_file'],review['evidence_sha256'])
        seen=set()
        for obs in gold['observations']:
            require(obs['id'] not in seen,'duplicate labeled occurrence');seen.add(obs['id'])
            require(obs['channel'] in {'email','phone'} and obs['status'] in {'supported','invalid','unsupported'},'invalid channel/status')
            require(obs['ownership'] in {'supported','unknown','shared'},'explicit ownership uncertainty required')
            require(bool(obs.get('raw')) and bool(obs.get('locator')),'raw source evidence required')
            require(obs['status']!='supported' or bool(obs.get('normalized')),'supported normalized value required')
            if obs['channel']=='phone':require(obs.get('kind') in {'phone','fax','ambiguous'} and 'extension' in obs,'phone kind/extension required')
            require(obs['ownership']!='unknown' or not obs.get('owners'),'unknown owner cannot carry supported gold edges')
            for edge in obs.get('owners',[]):
                require(edge['type'] in {'organization','site','person'} and bool(edge['id']),'invalid owner edge')
                require(not edge.get('business_id') or edge['business_id'] in page['business_ids'],'owner business outside inputs')
        entity_ids=[r['record_id'] for r in gold.get('entities',[])]
        require(len(entity_ids)==len(set(entity_ids)),'duplicate entity record')
    return m,bylabel,bodies

def clusters(pages):
    """Connected domain/template families are the bootstrap sampling units."""
    parent={p['id']:p['id'] for p in pages}
    def find(x):
        while parent[x]!=x:x=parent[x]
        return x
    groups={}
    for p in pages:
        for key in [('domain',p['domain_group']),('template',p['template_family'])]+[('business',b) for b in p['business_ids']]:
            if key in groups:parent[find(p['id'])]=find(groups[key])
            groups[key]=p['id']
    return {p['id']:find(p['id']) for p in pages}
