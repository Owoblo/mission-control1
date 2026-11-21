"""Local derived qualification of heuristic website relationship observations.

Original per-domain receipts remain unchanged. Only explicitly contextual,
unverified organisation/brand associations enter the graph review view.
"""
from __future__ import annotations
import argparse
import fcntl
from collections import Counter
import json
from pathlib import Path
import re
import time
from urllib.parse import urlsplit
from .relationship_observations import guard,save,identifier,stamp,digest
from .relationship_context import utility_reason,context_support

ACTION=re.compile(r'\b(?:apply now|view catalogue|parts finder|schedule an appointment|book (?:your )?appointment|log ?in|sign ?in|sign ?up|subscribe|opt.?out|cookie|privacy|do not sell|don.t sell|webbroker|easyweb|digital vault)\b',re.I)
MEDIA=re.compile(r'\.(?:jpe?g|png|gif|svg|webp|avif|pdf|mp[34]|zip|css|js)$',re.I)
CONTEXT=re.compile(r'\b(?:our|nos)\s+(?:clients|customers|partners|suppliers|dealers|brands|sponsors|members|tenants|partenaires|fournisseurs|marques|commanditaires)\b|'
                   r'\b(?:member of|subsidiary of|we sponsor|we manage|general contractor|project client|end client|trusted by|clients include|customers include|partnership with)\b',re.I)
ROUTE=re.compile(r'(?:^|/)(?:(?:our|nos)[-_])?(?:clients|customers|partners|suppliers|dealers|brands|sponsors|members|tenants|partenaires|fournisseurs|marques)(?:[-_/]|$)',re.I)
TECHNICAL={'aboutads.info','allaboutdnt.com','localiq.com','fpf.org','recallmax.com','doubleclick.net'}
UTILITY_PROVIDERS={'hsforms.com','jotform.com','jotformpro.com','typeform.com','formstack.com','review.nps.today'}
UTILITY_CTA=re.compile(r'^(?:get your project started|submit(?: a)? maintenance request|request (?:a )?(?:quote|consultation|callback)|leave (?:a )?review|review us|write (?:a )?review)$',re.I)


def utility_target(label,url):
    return bool(utility_reason(label,url))


def qualification(claim,source_state):
    if source_state.get('manual_review') or source_state['status'] in ('manual_review_hold','publisher_access_hold'):
        return 'held_source_identity_access_or_reuse'
    name=claim['target_company_or_association_label'];target=claim.get('target_website');path=urlsplit(target).path if target else ''
    host=(urlsplit(target).hostname or '') if target else ''
    utility=utility_reason(name,target,claim['source_page_url'])
    if utility:return utility
    if utility_target(name,target) or MEDIA.search(path) or ACTION.search(name+' '+path) or any(host==h or host.endswith('.'+h) for h in TECHNICAL):return 'non_relationship_media_action_or_technical_link'
    if name.startswith(('https://','http://')) or len(name.split())>10:return 'non_company_label_requires_review'
    support=context_support(claim)
    if support=='target_bound_relationship_context_not_established':return 'contextual_link_role_not_established'
    if support in {'personal_role_not_organisation_relationship','information_or_navigation_link','testimonial_page_context_not_target_relationship'}:return support
    if claim['source_organisation_id'] is None and claim.get('source_identity_status')!='shared_domain_publisher_name_evidence_only':return 'source_identity_unresolved'
    return 'logo_association_review' if claim['logo_only'] else 'directional_or_contextual_publisher_claim_review'


def review(folder):
    folder=Path(folder);guard(folder);view=folder/'qualified-graph-review';view.mkdir(exist_ok=True);counts=Counter();nodes={};leads={};rows=0;edges=0;pairs=set()
    with (view/'claim-review-dispositions.jsonl.tmp').open('w') as dispositions,(view/'graph-edges.jsonl.tmp').open('w') as graph:
        for path in sorted((folder/'domains').glob('*.json')):
            original=path.read_bytes();state=json.loads(original);receipt_hash=__import__('hashlib').sha256(original).hexdigest()
            for claim in state['claims']:
                status=qualification(claim,state);counts[status]+=1;rows+=1
                dispositions.write(json.dumps({'observation_id':claim['observation_id'],'qualification_status':status,
                    'publisher_domain':claim['publisher_domain'],'source_page_url':claim['source_page_url'],'page_content_sha256':claim['page_content_sha256'],
                    'source_receipt_file':str(path.relative_to(folder)),'original_receipt_sha256_at_review':receipt_hash,
                    'original_claim_sha256':identifier(claim),'original_claim_not_modified':True})+'\n')
                if status not in ('logo_association_review','directional_or_contextual_publisher_claim_review'):continue
                shared=len(state.get('organisations',[]))>1 or claim.get('source_account_attribution_scope')=='publisher_domain_only_shared_accounts'
                publisher=identifier('publisher-domain',claim['publisher_domain']) if shared else claim['source_organisation_id']
                if isinstance(publisher,str) and publisher.startswith('relationship-candidate:'):publisher=publisher.split(':',1)[1]
                target=identifier('related-label',claim['target_company_or_association_label'],claim.get('target_website'))
                nodes.setdefault(publisher,{'node_id':publisher,'label':claim['source_company_label'],'node_kind':'publisher_domain_context_shared_accounts' if shared else 'relationship_research_candidate' if claim.get('source_entity_kind')=='relationship_research_candidate' else 'existing_organisation_candidate',
                    'website':claim['source_website'],'legal_identity_verified_by_this_graph':False})
                nodes.setdefault(target,{'node_id':target,'label':claim['target_company_or_association_label'],'node_kind':'unresolved_publisher_related_label',
                    'website':claim.get('target_website'),'legal_identity_verified_by_this_graph':False})
                lead=leads.setdefault(target,{'lead_id':target,'published_label':claim['target_company_or_association_label'],'candidate_website':claim.get('target_website'),
                    'originating_claim_ids':[],'organisation_created':False,'inventory_merged':False,'target_type':'organisation_brand_or_association_unresolved','service_footprint_status':'unknown'})
                lead['originating_claim_ids'].append(claim['observation_id'])
                direction=claim['direction'];subject,object_id=(target,publisher) if direction=='target_to_source' else (publisher,target)
                if direction in ('target_to_project','target_to_property'):
                    # Page context is never silently turned into a building.
                    context_id=identifier('source-project-context-page',claim['source_page_url'])
                    nodes.setdefault(context_id,{'node_id':context_id,'label':claim.get('project_or_property_label'),'website':claim['source_page_url'],
                        'node_kind':'unverified_project_or_property_page_context','physical_property_verified':False})
                    subject,object_id=target,context_id
                pairs.add((subject,object_id,claim['claimed_predicate']))
                graph.write(json.dumps({'edge_id':claim['observation_id'],'subject_node':subject,'object_node':object_id,
                    'source_observation_predicate':claim['claimed_predicate'],'qualification_status':status,'direction':direction,
                    'source_page_url':claim['source_page_url'],'source_page_sha256':claim['page_content_sha256'],'observed_at':claim['observed_at'],
                    'short_context':claim['short_context'],'verified_relationship':False,'current_contract_verified':False,
                    'purchasing_authority_verified':False,'review_required':True},ensure_ascii=False)+'\n');edges+=1
    for name in ['claim-review-dispositions.jsonl','graph-edges.jsonl']:(view/(name+'.tmp')).replace(view/name)
    for name,values in [('graph-nodes.jsonl',nodes.values()),('related-company-label-review-queue.jsonl',leads.values())]:
        with (view/(name+'.tmp')).open('w') as stream:
            for value in values:stream.write(json.dumps(value,ensure_ascii=False)+'\n')
        (view/(name+'.tmp')).replace(view/name)
    report={'status':'derived_review_view_only','reviewed_at':stamp(),'raw_heuristic_observations_reviewed':rows,'disposition_counts':dict(counts),
        'qualified_unverified_graph_claim_observations':edges,'unique_source_target_predicate_candidates':len(pairs),
        'graph_nodes':len(nodes),'unresolved_related_label_leads':len(leads),'verified_relationships':0,
        'source_domain_receipts_unchanged':True,'main_database_access':False,'outreach_messages_sent':0,
        'graph_scope':'Directional/contextual publisher claims and explicit logos only; all remain unverified and require review.',
        'implementation_sha256':digest(Path(__file__)),'raw_collector_status_sha256':digest(folder/'status.json') if (folder/'status.json').exists() else None}
    save(view/'manifest.json',report);return report


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--folder',type=Path,required=True);parser.add_argument('--watch',action='store_true');args=parser.parse_args()
    previous=None
    while True:
        status=args.folder/'status.json';current=digest(status) if status.exists() else None
        if current!=previous:
            print(json.dumps(review(args.folder)),flush=True);previous=current
        if not args.watch:break
        with (args.folder/'collector.lock').open('a') as lock:
            try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB);active=False
            except BlockingIOError:active=True
        if not active:
            print(json.dumps(review(args.folder)),flush=True);break
        time.sleep(20)
