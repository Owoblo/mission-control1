"""Durable recursive research candidates, parallel evidence edges and email handoff.

Domains deduplicate HTTP work only. Candidate labels, source accounts, parallel
claims and geography uncertainty remain separate; no canonical entity is made.
"""
from __future__ import annotations
import argparse
from collections import Counter
from contextlib import closing
import hashlib
import gzip
import json
from pathlib import Path
import re
import sqlite3
from urllib.parse import urlsplit
from lxml import html
from .relationships import canonical_url,domain
from .relationship_observations import guard,save,stamp,identifier,digest
from .relationship_review import qualification,MEDIA,ACTION,utility_target

PLATFORMS={'facebook.com','instagram.com','linkedin.com','twitter.com','x.com','youtube.com','youtu.be','tiktok.com','pinterest.com',
    'yelp.com','yellowpages.ca','yp.ca','tripadvisor.com','tripadvisor.ca','bbb.org','wikipedia.org','linktr.ee','linktree.com',
    'restaurantguru.com','google.com','google.ca','goo.gl','maps.app.goo.gl','indeed.com','glassdoor.com','realtor.ca'}
REVIEW_VERSION='target-bound-context/2026-10-27.4'


def initialise(db):
    db.executescript('''
      CREATE TABLE IF NOT EXISTS research_candidates(candidate_id TEXT PRIMARY KEY,name TEXT,website_url TEXT,domain TEXT,
        resolution_status TEXT,geography_status TEXT,minimum_discovery_depth INTEGER,first_discovered_at TEXT,
        official_identity_status TEXT NOT NULL DEFAULT 'not_verified');
      CREATE TABLE IF NOT EXISTS recursive_edge_evidence(edge_id TEXT PRIMARY KEY,candidate_id TEXT,source_domain TEXT,
        source_url TEXT,parent_candidate_id TEXT,root_domain TEXT,discovery_depth INTEGER,relationship_type TEXT,direction TEXT,
        evidence_id TEXT,observed_at TEXT,resolution_status TEXT,payload_json TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS recursive_candidate_edges ON recursive_edge_evidence(candidate_id);
      CREATE INDEX IF NOT EXISTS research_candidate_domain_resolution ON research_candidates(domain,resolution_status);
      CREATE TABLE IF NOT EXISTS research_candidate_origins(candidate_id TEXT,edge_id TEXT,parent_candidate_id TEXT,
        source_domain TEXT,root_domain TEXT,discovery_depth INTEGER,PRIMARY KEY(candidate_id,edge_id));
      CREATE TABLE IF NOT EXISTS research_domains(domain TEXT PRIMARY KEY,candidate_id TEXT,root_domain TEXT,
        minimum_discovery_depth INTEGER,first_edge_id TEXT,discovered_at TEXT);
      CREATE TABLE IF NOT EXISTS recursive_intake_receipts(source_path TEXT PRIMARY KEY,mtime_ns INTEGER,size INTEGER,content_sha256 TEXT,
        reviewed_at TEXT,edges_seen INTEGER);
      CREATE TABLE IF NOT EXISTS email_bridge_batches(id TEXT PRIMARY KEY,path TEXT,sha256 TEXT,created_at TEXT,result_json TEXT);
      CREATE TABLE IF NOT EXISTS recursive_quality_reviews(edge_id TEXT PRIMARY KEY,candidate_id TEXT,prior_payload_json TEXT,
        updated_payload_json TEXT,reason TEXT,reviewed_at TEXT);
      CREATE TABLE IF NOT EXISTS recursive_quality_review_versions(id TEXT PRIMARY KEY,edge_id TEXT,candidate_id TEXT,
        prior_payload_json TEXT,updated_payload_json TEXT,reason TEXT,reviewed_at TEXT);
      CREATE TABLE IF NOT EXISTS reviewed_grid_members(source_url TEXT,source_id TEXT,ordinal INTEGER,target_domain TEXT,
        target_url TEXT,candidate_id TEXT,reviewed_label TEXT,source_xpath TEXT,source_artifact_sha256 TEXT,
        PRIMARY KEY(source_url,source_id,ordinal));
    ''');db.commit()


def disposition(claim,state):
    label=claim.get('target_company_or_association_label') or ''
    raw=claim.get('target_website');url=canonical_url(raw) if raw else None
    if not url:return 'unresolved_name_no_evidenced_website',None,None
    host=domain(url);path=urlsplit(url).path
    if utility_target(label,url) or any(host==p or host.endswith('.'+p) for p in PLATFORMS) or MEDIA.search(path) or ACTION.search(label+' '+path):
        return 'nonofficial_social_media_or_utility_review',url,host
    if not label.strip() or label.startswith(('http://','https://')) or re.search(r'\.(?:jpe?g|png|gif|svg|webp)$',label,re.I):
        return 'ambiguous_linked_label_requires_review',url,host
    if state.get('manual_review') or any(p.get('restriction_excerpts') for p in state.get('pages',[])):
        return 'source_rights_or_identity_hold',url,host
    status=qualification(claim,state)
    if claim.get('saved_explicit_statement_evidence_verified'):
        status='directional_or_contextual_publisher_claim_review'
    if status not in ('logo_association_review','directional_or_contextual_publisher_claim_review'):
        return status,url,host
    return 'direct_link_candidate',url,host


def add_claim(db,claim,state,*,source_receipt):
    """One edge per source occurrence; a known domain never merges candidates."""
    status,url,host=disposition(claim,state);name=claim.get('target_company_or_association_label') or None
    candidate=identifier('related-label',name,url)
    source_domain=claim['publisher_domain'];origin=state.get('research_origin') or {}
    depth=int(claim.get('relationship_discovery_depth',origin.get('discovery_depth',0)))+1
    parent=claim.get('parent_research_candidate_id') or origin.get('candidate_id')
    root=claim.get('relationship_root_domain') or origin.get('root_domain') or source_domain
    edge=claim['observation_id'];geography='unknown_external_research_candidate'
    payload={'candidate_id':candidate,'name':name,'website_url':url,'source_url':claim['source_page_url'],
        'source_domain':source_domain,'relationship_type':claim['claimed_predicate'],'evidence_id':edge,
        'resolution_status':status,'geography_status':geography,'discovery_depth':depth,'parent_candidate_id':parent,'root_domain':root,
        'source_observation_id':edge,'source_page_sha256':claim['page_content_sha256'],'observed_at':claim['observed_at'],
        'direction':claim['direction'],'source_company_label':claim.get('source_company_label'),'target_label':name,
        'source_organisation_id':claim.get('source_organisation_id'),'source_account_attribution_scope':claim.get('source_account_attribution_scope'),
        'logo_only':claim['logo_only'],'relationship_verified':False,'current_contract_verified':False,'official_website_identity_verified':False,
        'source_receipt':source_receipt,'short_context':claim['short_context'],'target_country':None,'target_province':None,
        'reviewed_grid_evidence':claim.get('reviewed_grid_evidence'),
        'target_service_footprint_membership':'unknown','no_MAIN_entity_created':True}
    inserted=db.execute('INSERT OR IGNORE INTO recursive_edge_evidence VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',
        (edge,candidate,source_domain,claim['source_page_url'],parent,root,depth,claim['claimed_predicate'],claim['direction'],edge,claim['observed_at'],status,json.dumps(payload,sort_keys=True))).rowcount
    if not inserted:
        existing=db.execute('SELECT candidate_id,resolution_status,payload_json FROM recursive_edge_evidence WHERE edge_id=?',(edge,)).fetchone()
        if existing['resolution_status']!=status:
            old=json.loads(existing['payload_json']);old.update(resolution_status=status,quality_hold_reason='Requalified against local relation context; '+status,qualification_revision=REVIEW_VERSION)
            revised=json.dumps(old,sort_keys=True);revision=identifier(edge,existing['payload_json'],revised)
            db.execute('INSERT OR IGNORE INTO recursive_quality_reviews VALUES(?,?,?,?,?,?)',(edge,existing['candidate_id'],existing['payload_json'],revised,old['quality_hold_reason'],stamp()))
            db.execute('INSERT OR IGNORE INTO recursive_quality_review_versions VALUES(?,?,?,?,?,?,?)',(revision,edge,existing['candidate_id'],existing['payload_json'],revised,old['quality_hold_reason'],stamp()))
            db.execute('UPDATE recursive_edge_evidence SET resolution_status=?,payload_json=? WHERE edge_id=?',(status,revised,edge))
        return {'new_edges':0,'new_candidates':0,'new_domains':0,'status':status}
    added=db.execute('INSERT OR IGNORE INTO research_candidates(candidate_id,name,website_url,domain,resolution_status,geography_status,minimum_discovery_depth,first_discovered_at) VALUES(?,?,?,?,?,?,?,?)',
        (candidate,name,url,host,status,geography,depth,stamp())).rowcount
    db.execute('UPDATE research_candidates SET minimum_discovery_depth=MIN(minimum_discovery_depth,?),resolution_status=CASE WHEN ?=\'direct_link_candidate\' THEN ? ELSE resolution_status END WHERE candidate_id=?',(depth,status,status,candidate))
    db.execute('INSERT OR IGNORE INTO research_candidate_origins VALUES(?,?,?,?,?,?)',(candidate,edge,parent,source_domain,root,depth))
    new_domain=0
    if status=='direct_link_candidate':
        new_domain=db.execute('INSERT OR IGNORE INTO research_domains VALUES(?,?,?,?,?,?)',(host,candidate,root,depth,edge,stamp())).rowcount
        db.execute('INSERT OR IGNORE INTO jobs(domain,id,url,priority) VALUES(?,?,?,?)',(host,hashlib.sha256(host.encode()).hexdigest(),url,'zz'+identifier(host)))
        route_added=db.execute('INSERT OR IGNORE INTO frontier(domain,url,depth,kind,status,discovered_on) VALUES(?,?,0,\'recursive_evidenced_site\',\'pending\',?)',(host,url,claim['source_page_url'])).rowcount
        db.execute('INSERT OR IGNORE INTO associations VALUES(?,?,?,?,?)',('relationship-candidate:'+candidate,host,url,name,host))
        if route_added:db.execute('UPDATE jobs SET queue_status=\'pending\' WHERE domain=? AND queue_status NOT IN (\'review_hold\')',(host,))
    return {'new_edges':1,'new_candidates':added,'new_domains':new_domain,'status':status}


def repair_utility_links(db):
    repaired=0;domains=set();preserved_original_jobs=0
    for candidate in db.execute('SELECT candidate_id,name,website_url,domain FROM research_candidates').fetchall():
        if not utility_target(candidate['name'],candidate['website_url']):continue
        cid=candidate['candidate_id'];host=candidate['domain'];domains.add(host)
        with db:
            db.execute('UPDATE research_candidates SET resolution_status=\'nonofficial_social_media_or_utility_review\' WHERE candidate_id=?',(cid,))
            for edge in db.execute('SELECT edge_id,payload_json FROM recursive_edge_evidence WHERE candidate_id=?',(cid,)).fetchall():
                payload=json.loads(edge['payload_json'])
                if payload['resolution_status']=='nonofficial_social_media_or_utility_review':continue
                payload.update(resolution_status='nonofficial_social_media_or_utility_review',quality_hold_reason='Form/CTA/review route is not a company relationship website')
                revised=json.dumps(payload,sort_keys=True)
                db.execute('INSERT OR IGNORE INTO recursive_quality_reviews VALUES(?,?,?,?,?,?)',(edge['edge_id'],cid,edge['payload_json'],revised,payload['quality_hold_reason'],stamp()))
                db.execute('UPDATE recursive_edge_evidence SET resolution_status=?,payload_json=? WHERE edge_id=?',('nonofficial_social_media_or_utility_review',revised,edge['edge_id']));repaired+=1
            original=db.execute('SELECT COUNT(*) FROM associations WHERE domain=? AND organisation_id NOT LIKE \'relationship-candidate:%\'',(host,)).fetchone()[0]
            if original:preserved_original_jobs+=1
            else:db.execute('UPDATE jobs SET queue_status=\'review_hold\',state_status=\'recursive_utility_link_hold\' WHERE domain=?',(host,))
    return {'reclassified_edge_rows':repaired,'utility_domains_reviewed':sorted(domains),'original_domain_jobs_preserved':preserved_original_jobs,'raw_source_observations_unchanged':True}


def ingest_domain_receipts(db,folder):
    folder=Path(folder);counts=Counter()
    previous=db.execute('SELECT value_json FROM seed_meta WHERE key=\'recursive_review_version\'').fetchone()
    force=not previous or json.loads(previous[0])!=REVIEW_VERSION
    for path in sorted((folder/'domains').glob('*.json')):
        stat=path.stat();old=db.execute('SELECT mtime_ns,size FROM recursive_intake_receipts WHERE source_path=?',(str(path),)).fetchone()
        if not force and old and tuple(old)==(stat.st_mtime_ns,stat.st_size):continue
        guard(folder);body=path.read_bytes();state=json.loads(body)
        with db:
            for claim in state.get('claims',[]):counts.update({k:v for k,v in add_claim(db,claim,state,source_receipt=str(path)).items() if k!='status'})
            db.execute('INSERT OR REPLACE INTO recursive_intake_receipts VALUES(?,?,?,?,?,?)',
                (str(path),stat.st_mtime_ns,stat.st_size,hashlib.sha256(body).hexdigest(),stamp(),len(state.get('claims',[]))))
    with db:db.execute('INSERT OR REPLACE INTO seed_meta VALUES(?,?)',('recursive_review_version',json.dumps(REVIEW_VERSION)))
    return dict(counts)


def reconcile_candidate_reviews(db,folder):
    """Recompute active candidates from edge evidence, never erase source rows."""
    with db:
        db.execute('''UPDATE research_candidates SET resolution_status=CASE
          WHEN EXISTS(SELECT 1 FROM recursive_edge_evidence e WHERE e.candidate_id=research_candidates.candidate_id AND e.resolution_status='direct_link_candidate') THEN 'direct_link_candidate'
          ELSE COALESCE((SELECT e.resolution_status FROM recursive_edge_evidence e WHERE e.candidate_id=research_candidates.candidate_id ORDER BY e.observed_at DESC,e.edge_id LIMIT 1),resolution_status) END''')
        db.execute("""UPDATE jobs SET queue_status='pending',state_status='quality_evidence_restored'
          WHERE state_status='recursive_quality_link_hold'
          AND EXISTS(SELECT 1 FROM research_candidates c WHERE c.domain=jobs.domain AND c.resolution_status='direct_link_candidate')
          AND EXISTS(SELECT 1 FROM frontier f WHERE f.domain=jobs.domain AND f.status='pending')""")
    held=[]
    for row in db.execute('''SELECT r.domain FROM research_domains r WHERE NOT EXISTS
      (SELECT 1 FROM research_candidates c WHERE c.domain=r.domain AND c.resolution_status='direct_link_candidate')''').fetchall():
        host=row['domain'];original=db.execute('SELECT COUNT(*) FROM associations WHERE domain=? AND organisation_id NOT LIKE \'relationship-candidate:%\'',(host,)).fetchone()[0]
        if not original:
            with db:db.execute('UPDATE jobs SET queue_status=\'review_hold\',state_status=\'recursive_quality_link_hold\' WHERE domain=?',(host,))
        held.append({'domain':host,'original_associations_preserved':original,'candidate_only_job_held':not bool(original)})
    path=Path(folder)/'recursive-frontier'/'quality-retractions.jsonl';path.parent.mkdir(exist_ok=True)
    with path.open('w') as stream:
        for row in db.execute('SELECT edge_id,candidate_id,prior_payload_json,updated_payload_json,reason FROM recursive_quality_reviews'):
            before=json.loads(row['prior_payload_json']);after=json.loads(row['updated_payload_json'])
            if before.get('resolution_status')!='direct_link_candidate' or after.get('resolution_status')=='direct_link_candidate':continue
            stream.write(json.dumps({'candidate_id':row['candidate_id'],'evidence_id':row['edge_id'],'website_url':after['website_url'],
                'source_url':after['source_url'],'resolution_status':after['resolution_status'],'reason':row['reason'],
                'candidate_has_other_eligible_evidence':bool(db.execute('SELECT 1 FROM research_candidates WHERE candidate_id=? AND resolution_status=\'direct_link_candidate\'',(row['candidate_id'],)).fetchone()),
                'original_payload_retained':True})+'\n')
    return {'inactive_research_domain_reviews':held,'email_retraction_handoff':str(path),'raw_source_records_unchanged':True}


def ingest_saved_explicit(db,path):
    """Accept saved native statements only after original body hash/link checks."""
    path=Path(path);counts=Counter()
    for line in path.read_text().splitlines():
        if not line.strip():continue
        source=json.loads(line);artifact=Path(source['source_artifact'])
        if digest(artifact)!=source['source_artifact_sha256']:raise ValueError('Saved explicit relationship source checksum differs')
        body=gzip.decompress(artifact.read_bytes()) if artifact.suffix=='.gz' else artifact.read_bytes()
        if source.get('source_original_whole_sha256') and hashlib.sha256(body).hexdigest()!=source['source_original_whole_sha256']:raise ValueError('Saved original whole-byte source checksum differs')
        document=html.fromstring(body.decode('utf-8',errors='replace'));text=' '.join(document.text_content().split())
        statement=' '.join(source.get('source_statement','').split());target=canonical_url(source['object_website']) if source.get('object_website') else None
        links={canonical_url(value,source['source_url']) for value in document.xpath('//a/@href')}
        if statement:
            if statement not in text:raise ValueError('Saved explicit statement not supported by original body')
        else:
            h1=' '.join(document.xpath('//h1//text()'));normal=lambda value:re.sub(r'\W+','',value.casefold())
            if normal(source['object_name_published']) not in normal(h1) or '/community-partners/' not in source['source_url']:raise ValueError('Saved community organisation partner h1/profile scope differs')
            statement=source.get('source_qualification','Published community-organisation partner profile')+'; '+source['object_name_published']
        if target and target not in links:raise ValueError('Saved target link not supported by original body')
        grid=None
        if source.get('source_role')=='partner_grid':
            selected=document.xpath(source['source_element_xpath'])
            if len(selected)!=1 or selected[0].tag!='img':raise ValueError('Reviewed grid image locator differs')
            img=selected[0];anchors=img.xpath('ancestor::a[1]')
            if not anchors or anchors[0].get('href')!=source['published_anchor_href'] or img.get('src')!=source['published_img_src'] or img.get('alt')!=source.get('published_img_alt'):
                raise ValueError('Reviewed grid image/link attributes differ')
            for proof in source.get('reviewed_label_proof',[]):
                if digest(Path(proof['path']))!=proof['sha256']:raise ValueError('Reviewed logo visual proof hash differs')
            grid={key:source.get(key) for key in ('source_id','source_element_ordinal','source_element_xpath','published_img_src','published_img_alt','published_anchor_title','published_anchor_href','label_resolution_method','reviewed_label_proof')}
        claim={'observation_id':identifier('saved-explicit',source['source_id'],source['source_record_id']),
            'publisher_domain':domain(source['source_url']),'source_page_url':source['source_url'],'source_company_label':source['subject_name'],
            'source_organisation_id':None,'source_identity_status':'saved_publisher_statement_evidence','target_company_or_association_label':source['object_name_published'],
            'target_website':target,'claimed_predicate':source['predicate'],'direction':source['direction'],'logo_only':False,
            'short_context':statement,'source_page_title':source['subject_name'],'page_content_sha256':hashlib.sha256(body).hexdigest(),
            'observed_at':source['observed_at'],'saved_explicit_statement_evidence_verified':True,'reviewed_grid_evidence':grid}
        state={'status':'saved_explicit_statement','pages':[],'organisations':[]}
        with db:
            counts.update({k:v for k,v in add_claim(db,claim,state,source_receipt=str(path)).items() if k!='status'})
            if grid:
                db.execute('INSERT OR REPLACE INTO reviewed_grid_members VALUES(?,?,?,?,?,?,?,?,?)',
                    (source['source_url'],source['source_id'],source['source_element_ordinal'],domain(target),target,
                     identifier('related-label',source['object_name_published'],target),source['object_name_published'],source['source_element_xpath'],hashlib.sha256(body).hexdigest()))
    return dict(counts)


def export_handoff(db,folder,email_queue=None):
    folder=Path(folder);guard(folder);directory=folder/'recursive-frontier';directory.mkdir(exist_ok=True)
    edges=db.execute('SELECT edge_id,payload_json FROM recursive_edge_evidence ORDER BY edge_id');rolling=hashlib.sha256();count=0
    temporary=directory/'relationship-email-handoff.jsonl.tmp'
    with temporary.open('wb') as stream:
        for row in edges:
            data=(row['payload_json']+'\n').encode();stream.write(data);rolling.update(data);count+=1
    path=directory/'relationship-email-handoff.jsonl';temporary.replace(path)
    handoff_hash=rolling.hexdigest();bridge=None
    if email_queue:
        previous=db.execute('SELECT result_json FROM email_bridge_batches WHERE id=?',(handoff_hash,)).fetchone()
        if previous:bridge={**json.loads(previous[0]),'already_applied_same_handoff':True}
        else:
            from .relationship_email_bridge import ingest
            guard(folder);bridge=ingest(path,email_queue)
            with db:db.execute('INSERT INTO email_bridge_batches VALUES(?,?,?,?,?)',(handoff_hash,str(path),handoff_hash,stamp(),json.dumps(bridge,sort_keys=True)))
    statuses={row[0]:row[1] for row in db.execute('SELECT resolution_status,COUNT(*) FROM research_candidates GROUP BY resolution_status')}
    report={'updated_at':stamp(),'candidate_resolution_counts':statuses,'candidate_nodes':db.execute('SELECT COUNT(*) FROM research_candidates').fetchone()[0],
        'parallel_source_edge_evidence_rows':count,'recursive_domains':db.execute('SELECT COUNT(DISTINCT domain) FROM research_candidates WHERE resolution_status=\'direct_link_candidate\'').fetchone()[0],
        'historical_recursive_domain_records_preserved':db.execute('SELECT COUNT(*) FROM research_domains').fetchone()[0],
        'maximum_observed_relationship_discovery_depth':db.execute('SELECT MAX(discovery_depth) FROM recursive_edge_evidence').fetchone()[0],
        'reviewed_grid_pages':[dict(row) for row in db.execute('SELECT source_url,source_id,COUNT(*) AS grid_members,COUNT(DISTINCT target_domain) AS linked_domains FROM reviewed_grid_members GROUP BY source_url,source_id')],
        'handoff_file':str(path),'handoff_sha256':handoff_hash,'email_bridge':bridge,'previous_export_only_gap_now_operational':True,
        'no_relationship_hop_scope_cap':True,'cycles_deduplicate_domain_work_not_edges':True,'official_identities_verified':0,'verified_relationships':0,'MAIN_entities_created':0,
        'geography_scope':'External/out-of-service membership unknown retained separately; no country/province/service-area inference from domain or link.'}
    save(directory/'manifest.json',report);return report


def advance(db,folder,email_queue=None,explicit_paths=()):
    initialise(db);counts=ingest_domain_receipts(db,folder)
    for path in explicit_paths:
        for key,value in ingest_saved_explicit(db,path).items():counts[key]=counts.get(key,0)+value
    repair=repair_utility_links(db);reconciliation=reconcile_candidate_reviews(db,folder)
    report=export_handoff(db,folder,email_queue);report['this_advance']=counts;report['utility_quality_repair']=repair;report['context_quality_reconciliation']=reconciliation
    save(Path(folder)/'recursive-frontier'/'manifest.json',report);return report


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--folder',type=Path,required=True);parser.add_argument('--email-queue');parser.add_argument('--explicit-claims',action='append',default=[]);args=parser.parse_args()
    from .relationship_queue import initialise as queue_initialise
    import fcntl
    with (args.folder/'collector.lock').open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        with closing(queue_initialise(args.folder/'queue.sqlite')) as db:
            print(json.dumps(advance(db,args.folder,args.email_queue,args.explicit_claims)),flush=True)
