"""Resumable derived public relationship claims; never canonical inventory writes.

Every seed remains in the queue. Page/depth limits bound a wave, not a website
or market. Logos are associations; no observation verifies a contract or owner.
"""
from __future__ import annotations
import argparse
import fcntl
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
import hashlib
import gzip
import json
from pathlib import Path
import re
import shutil
import threading
from urllib.parse import urlsplit
from lxml import html
from .relationships import parse_page, canonical_url, identity_supported, domain, RELEVANT, UTILITY
from .transport import Transport, SourceBlocked, BudgetExceeded
from .relationship_context import context_support,PERSONAL_ROLE,ROSTER_HEADING
from .logo_inventory import inventory_logos
from .store import stamp

VERSION='ssm-derived-relationship-observations/2'
MIN_FREE=2147483648
FOCUS=['proactiveindustrial.ca','kycoengineering.com','protrades.ca','kuceras.com','specialtyvegetableequipment.com',
       'wolverinemfg.ca','iroquoissteel.com','terapro.ca','workshopsupply.com','rehein.com','dsdownham.ca','aaelectrical.ca']
SOCIAL={'facebook.com','instagram.com','linkedin.com','twitter.com','x.com','youtube.com','youtu.be','tiktok.com','pinterest.com',
        'google.com','google.ca','goo.gl','g.page','maps.app.goo.gl','cloudflare.com','w3.org','schema.org'}
POLICY=re.compile(r'privacy|terms|legal|copyright',re.I)
RELATION_HEADING=re.compile(r'\b(?:our\s+|nos\s+)?(?:clients|customers|partners|suppliers|sponsors|members|brands|partenaires|fournisseurs|marques|membres|commanditaires)\b|\btrusted by\b',re.I)
GRAPH_RELEVANT=re.compile(RELEVANT.pattern+r'|partenaires|fournisseurs|marques|concessionnaires|locataires|r[ée]alisations|projets|commanditaires',re.I)
DISCOVERY_HUB=re.compile(r'(?<![a-z])(?:blogs?|news(?:room)?|press(?:[- /]room|[- /]releases?)?|announcements?|about(?:[- /]us)?|our[- /]story|company[- /]information|corporate)(?![a-z])',re.I)

GENERIC_LINK=re.compile(r'^(?:apply now|view catalogue|parts finder|parts lookup|learn more|read more|visit (?:our )?website|website|click here|subscribe|view all|contact us|shop now|book now|buy now)$',re.I)
RESTRICTION=re.compile(r'(?:personal\s+(?:and\s+)?non[- ]commercial|non[- ]commercial\s+(?:personal\s+)?use|personal use only|'
                       r'commercial (?:use|reproduction|copying).{0,100}(?:prohibited|permission|consent)|'
                       r'(?:prohibit|may not|must not|not permitted).{0,100}(?:scrap|robots|automated|commercial use))',re.I)


class StorageHold(RuntimeError):pass


def guard(path):
    if shutil.disk_usage(path).free<MIN_FREE:raise StorageHold('At least2GiB free required; network and output paused')


def digest(path):
    value=hashlib.sha256()
    with Path(path).open('rb') as stream:
        for block in iter(lambda:stream.read(1048576),b''):value.update(block)
    return value.hexdigest()


def save(path,data):
    guard(path.parent);temporary=path.with_suffix(path.suffix+'.tmp')
    with temporary.open('w',encoding='utf-8') as stream:json.dump(data,stream,ensure_ascii=False,sort_keys=True);stream.write('\n')
    temporary.replace(path)


def identifier(*values):return hashlib.sha256(json.dumps(values,sort_keys=True).encode()).hexdigest()


def anchor_label(anchor):
    text=' '.join(anchor.text_content().split())
    if text:return text
    alternatives=[anchor.get('aria-label',''),anchor.get('title',''),*anchor.xpath('.//img/@alt'),*anchor.xpath('.//img/@title')]
    labels=[' '.join(value.split()) for value in alternatives if value.strip()]
    meaningful=[value for value in labels if not re.search(r'\.(?:png|jpe?g|gif|svg|webp)$',value,re.I) and not re.fullmatch(r'logo|image|photo',value,re.I)]
    return (meaningful or labels or [''])[0]


def parse_claim_page(body,url):
    """Reuse the tested directional parser, plus explicitly contextual logos.

    Existing parser's technology exclusion is deliberately not an exclusion of
    real corporate clients such as Apple/Microsoft when named in client pages.
    """
    if isinstance(body,bytes):
        try:body=body.decode('utf-8')
        except UnicodeDecodeError:pass
    page=parse_page(body,url);document=html.fromstring(body,base_url=url)
    for node in document.xpath('//script|//style|//noscript'):node.drop_tree()
    title=page['title'];label=urlsplit(url).path+' '+title;seen={(r['name'],r['url']) for r in page['assertions']}
    policies=[];discovery=[]
    for anchor in document.xpath('//a[@href]'):
        target=canonical_url(anchor.get('href'),url);name=' '.join(anchor.text_content().split())
        if target and domain(target)==domain(url):
            if POLICY.search(name+' '+urlsplit(target).path):policies.append(target)
            elif GRAPH_RELEVANT.search(name+' '+urlsplit(target).path) and not UTILITY.search(name):page['links'].append(target)
            elif DISCOVERY_HUB.search(name+' '+urlsplit(target).path) and not UTILITY.search(name+' '+urlsplit(target).path):discovery.append(target)
        if not target or domain(target)==domain(url) or any(domain(target)==item or domain(target).endswith('.'+item) for item in SOCIAL):continue
        if anchor.xpath('ancestor::footer|ancestor::nav|ancestor::header'):continue
        logo=not name and bool(anchor.xpath('.//img'))
        if not name:name=anchor_label(anchor)
        if not name or len(name)>180 or UTILITY.search(name) or GENERIC_LINK.fullmatch(name.strip('\u200b ')) or name.lower() in {'logo','image'}:continue
        block=anchor
        for parent in anchor.iterancestors():
            if parent.tag in ('p','li','article','section','div') and len(' '.join(parent.text_content().split()))<=700:block=parent;break
        context=' '.join(block.text_content().split())
        if not GRAPH_RELEVANT.search(label+' '+context) or UTILITY.search(context) or (name,target) in seen:continue
        page['assertions'].append({'name':name,'url':target,'domain':domain(target),'predicate':'unverified_association',
            'direction':'source_to_target','object_type':'organisation','excerpt':context[:700],'property_name':None,'logo_only':logo,'page_title':title[:250]})
        seen.add((name,target))
    # An unlinked client logo has no guessed target website or legal identity.
    for image in document.xpath('//img[@alt][not(ancestor::a)][not(ancestor::footer)][not(ancestor::nav)][not(ancestor::header)]'):
            presentation=' '.join([image.get('alt',''),image.get('src',''),image.get('class','')])
            if not re.search(r'logo|brand[-_ ]?(?:mark|image)|client[-_ ]?(?:logo|image)|partner[-_ ]?(?:logo|image)',presentation,re.I):continue
            contextual=bool(RELATION_HEADING.search(title+' '+urlsplit(url).path));context='Unlinked logo label on '+title
            for parent in image.iterancestors():
                if parent.tag in ('div','section','article','li'):
                    local=' '.join(parent.text_content().split())
                    headings=' '.join(parent.xpath('.//h2//text()|.//h3//text()|.//h4//text()'))
                    if len(local)<=700 and RELATION_HEADING.search(headings):contextual=True;context=local;break
            if not contextual:continue
            name=' '.join(image.get('alt','').split())
            if not name or len(name)>180 or re.fullmatch(r'logo|image|photo|banner|icon|placeholder',name,re.I) or UTILITY.search(name) or (name,None) in seen:continue
            page['assertions'].append({'name':name,'url':None,'domain':None,'predicate':'unverified_association','direction':'source_to_target',
                'object_type':'unresolved_related_publisher_label','excerpt':context[:350],'property_name':None,'logo_only':True,'page_title':title[:250]})
            seen.add((name,None))
    for claim in page['assertions']:
        if claim['logo_only']:claim.update(predicate='unverified_association',direction='source_to_target')
        elif claim['predicate']=='unverified_association':
            if re.search(r'\bour suppliers\b|\bnos fournisseurs\b',label,re.I):claim.update(predicate='claimed_supplier_of',direction='target_to_source')
            elif re.search(r'\bour dealers\b|\bdealer directory\b|\bnos concessionnaires\b',label,re.I):claim.update(predicate='claimed_dealer_of',direction='target_to_source')
            elif re.search(r'\bnos partenaires\b',label,re.I):claim.update(predicate='listed_partner_of')
            elif re.search(r'\bour brands\b|\bnos marques\b',label,re.I):claim.update(predicate='listed_brand_association',object_type='brand_or_organisation_unresolved')
        claim['excerpt']=claim['excerpt'][:350]
        # Retain the actual local paragraph/roster heading, independently of
        # any broad page-title inference made by the legacy parser.
        matches=[]
        for anchor in document.xpath('//a[@href]'):
            if canonical_url(anchor.get('href'),url)!=claim.get('url'):continue
            anchor_name=anchor_label(anchor)
            if anchor_name!=claim['name']:continue
            matches.append(anchor)
        if matches:
            anchor=matches[0];local=anchor.text_content();heading=None
            for parent in anchor.iterancestors():
                if parent.tag in ('p','li','td','tr','figcaption'):
                    local=' '.join(parent.text_content().split());break
                if parent.tag in ('section','article','div'):
                    text=' '.join(parent.text_content().split())
                    if len(text)<=800:local=text
                    headings=parent.xpath('./h1//text()|./h2//text()|./h3//text()|./header/h2//text()')
                    candidate=' '.join(' '.join(headings).split())
                    if ROSTER_HEADING.fullmatch(candidate):heading=candidate;break
            claim['anchor_local_context']=' '.join(local.split())[:500]
            claim['local_relationship_heading']=heading
            claim['local_individual_role_context']=bool(PERSONAL_ROLE.search(local))
            claim['source_dom_locator']=document.getroottree().getpath(anchor)
        support=context_support({'target_company_or_association_label':claim['name'],'source_page_url':url,'source_page_title':title,
            'short_context':claim['excerpt'],'anchor_local_context':claim.get('anchor_local_context'),'local_relationship_heading':claim.get('local_relationship_heading'),
            'logo_only':claim['logo_only'],'source_company_label':None})
        claim['relationship_context_support']=support
        if support in {'personal_role_not_organisation_relationship','information_or_navigation_link','testimonial_page_context_not_target_relationship','target_bound_relationship_context_not_established'}:
            claim['parser_predicate_candidate']=claim['predicate'];claim['predicate']='unverified_association';claim['direction']='source_to_target'
    page['assertions']=[r for r in page['assertions'] if not GENERIC_LINK.fullmatch(r['name'].strip('\u200b '))]
    text=page['text'];matches=[text[max(0,m.start()-70):m.end()+180] for m in RESTRICTION.finditer(text)]
    inventory=inventory_logos(body,page_url=url)
    unresolved=[row['image_occurrence_id'] for row in inventory['all_images'] if not row['has_non_generic_source_label'] or any(label['filename_like_label'] for label in row['source_label_candidates'])]
    visual_pending=bool(RELATION_HEADING.search(title+' '+urlsplit(url).path) and unresolved)
    # Policy pages are inspected for restrictions, not used to walk locale/legal trees.
    if POLICY.search(urlsplit(url).path):
        page['links']=[];policies=[];discovery=[]
    return {**page,'policy_links':sorted(set(policies)),'discovery_links':sorted(set(discovery)),'restriction_excerpts':matches[:8],
            'logo_inventory':inventory,'visual_review_status':'visual_review_pending' if visual_pending else 'not_triggered_no_completeness_claim',
            'unresolved_image_occurrence_ids':unresolved}


def claim_observations(job,page,url,body_hash,checked_at,identity_matches,rights_status):
    result=[]
    for occurrence,raw in enumerate(page['assertions']):
        sources=[row for row in job['organisations'] if row['organisation_id'] in identity_matches]
        shared_domain=len(job['organisations'])>1
        if shared_domain:
            names=sorted({row['name'] for row in sources})
            sources=[{'organisation_id':None,'name':names[0] if len(names)==1 else None}]
        if not sources:sources=[{'organisation_id':None,'name':None}]
        for source in sources:
            name=source['name'];target=raw['name'];direction=raw['direction']
            if direction=='target_to_source':subject,object_label=target,name
            elif direction in ('target_to_project','target_to_property'):subject,object_label=target,raw.get('property_name')
            else:subject,object_label=name,target
            result.append({'observation_id':identifier(job['job_id'],url,body_hash,occurrence,raw['name'],raw.get('url'),raw['predicate'],source['organisation_id']),
                'page_occurrence_ordinal':occurrence,'relationship_discovery_depth':job.get('research_origin',{}).get('discovery_depth',0),
                'parent_research_candidate_id':job.get('research_origin',{}).get('candidate_id'),'relationship_root_domain':job.get('research_origin',{}).get('root_domain'),
                'domain_job_id':job['job_id'],'publisher_domain':job['domain'],'source_organisation_id':source['organisation_id'],
                'source_company_label':name,'candidate_source_organisations':job['organisations'] if source['organisation_id'] is None and not job.get('association_reference') else [],
                'source_domain_association_reference':job.get('association_reference'),'source_candidate_association_count':len(job['organisations']),
                'source_account_attribution_scope':'publisher_domain_only_shared_accounts' if shared_domain else 'single_candidate_self_identification_only',
                'source_entity_kind':'relationship_research_candidate' if str(source['organisation_id']).startswith('relationship-candidate:') else 'inventory_candidate_or_unknown',
                'source_website':job['candidate_urls'][0],
                'target_company_or_association_label':target,'target_website':raw.get('url'),'target_domain':raw.get('domain'),
                'claimed_predicate':raw['predicate'],'direction':direction,'subject_label':subject,'object_label':object_label,
                'object_type':raw['object_type'],'project_or_property_label':raw.get('property_name'),'logo_only':raw['logo_only'],
                'source_page_url':url,'source_page_title':page['title'][:250],'short_context':raw['excerpt'],'page_content_sha256':body_hash,
                'anchor_local_context':raw.get('anchor_local_context'),'local_relationship_heading':raw.get('local_relationship_heading'),
                'local_individual_role_context':raw.get('local_individual_role_context',False),'source_dom_locator':raw.get('source_dom_locator'),
                'relationship_context_support':raw.get('relationship_context_support'),'parser_predicate_candidate':raw.get('parser_predicate_candidate'),
                'observed_at':checked_at,'source_identity_status':'shared_domain_publisher_name_evidence_only' if shared_domain and name else 'heading_self_identification_evidence' if name else 'unresolved_source_identity',
                'review_status':'publisher_claim_unverified','rights_status':rights_status,'contract_verified':False,'current_relationship_verified':False,
                'legal_ownership_verified':False,'purchasing_authority_verified':False,'target_company_legal_identity_verified':False,'named_person_enriched':False})
    return result


class WaveBudget:
    def __init__(self,max_bytes=90000000):self.maximum=max_bytes;self.used=0;self.reserved=0;self.lock=threading.Lock()
    def reserve(self,amount):
        with self.lock:
            if self.used+self.reserved+amount>self.maximum:return False
            self.reserved+=amount;return True
    def finish(self,reserved,used):
        with self.lock:self.reserved-=reserved;self.used+=used


def eligible(state,max_depth):
    return state.get('status') not in ('manual_review_hold','publisher_access_hold','storage_paused','network_retry_requires_review') and any(p['status']=='pending' and p['depth']<=max_depth for p in state['frontier'])


def observe_domain(job,output,overlay,budget,*,max_pages=3,max_depth=1,transport_factory=None):
    path=output/'domains'/(job['job_id']+'.json');guard(output)
    state=json.loads(path.read_text()) if path.exists() else {'job_id':job['job_id'],'domain':job['domain'],'organisations':job['organisations'],
        'candidate_urls':job['candidate_urls'],'frontier':[{'url':job['candidate_urls'][0],'depth':0,'kind':'initial_site','status':'pending'}],
        'pages':[],'claims':[],'identity_matches':[],'invocations':[],'status':'queued','full_site_exhausted':False,'main_database_access':False}
    review=overlay.get('reviews',{}).get(job['domain'])
    if job.get('research_origin'):state['research_origin']=job['research_origin']
    known_frontier={item['url'] for item in state['frontier']}
    for item in job.get('seed_frontier',[]):
        if item['url'] not in known_frontier:state['frontier'].append(dict(item));known_frontier.add(item['url'])
    if review and review.get('reuse_status') in ('hold_pending_permission','do_not_apply_to_candidate','not_cleared_by_this_review'):
        state.update(status='manual_review_hold',manual_review=review);save(path,state);return state
    allowance=5000000
    if not budget.reserve(allowance):return {'job_id':job['job_id'],'domain':job['domain'],'status':'wave_resource_budget_deferred'}
    transport=(transport_factory() if transport_factory else Transport(max_requests=12,max_bytes=allowance,max_response_bytes=1500000,timeout=10,min_interval=.5,retries=0))
    attempted=0;state['status']='observing';identity=set(state['identity_matches']);held=False
    try:
        while attempted<max_pages:
            pending=[p for p in state['frontier'] if p['status']=='pending' and p['depth']<=max_depth]
            if not pending:break
            pending.sort(key=lambda p:(p['depth'],0 if p['kind']=='linked_policy' else 1,p['url']))
            item=pending[0];url=item['url'];host=urlsplit(url).hostname;allowed={host,host.removeprefix('www.'),'www.'+host.removeprefix('www.')}
            if (output/'pause-requested').exists():state['status']='wave_paused_frontier_retained';held=True;break
            guard(output);attempted+=1
            try:
                response=transport.fetch(url,allowed_hosts=allowed)
                content=next((v for k,v in response.headers.items() if k.lower()=='content-type'),'')
                if content and 'html' not in content.lower():item.update(status='non_html_requires_review');continue
                page=parse_claim_page(response.body,response.url);checked=stamp();body_hash=hashlib.sha256(response.body).hexdigest()
                for organisation in job['organisations']:
                    if identity_supported(organisation['name'],page):identity.add(organisation['organisation_id'])
                restrictions=page['restriction_excerpts'];rights='publisher_restriction_requires_review' if restrictions else 'limited_factual_review_only_no_open_licence'
                claims=claim_observations(job,page,response.url,body_hash,checked,identity,rights)
                audit_folder=output/'logo-inventories';audit_folder.mkdir(exist_ok=True);guard(output)
                audit_path=audit_folder/(identifier(response.url,body_hash)+'.json.gz')
                if not audit_path.exists():
                    audit_path.write_bytes(gzip.compress(json.dumps(page['logo_inventory'],ensure_ascii=False).encode(),mtime=0))
                state['claims'].extend(c for c in claims if c['observation_id'] not in {old['observation_id'] for old in state['claims']})
                state['pages'].append({'url_requested':url,'url_final':response.url,'content_sha256':body_hash,'observed_at':checked,'title':page['title'][:300],
                    'source_bytes':len(response.body),'depth':item['depth'],'claims_observed':len(claims),'restriction_excerpts':restrictions,
                    'logo_inventory_file':str(audit_path),'logo_inventory_sha256':digest(audit_path),'logo_inventory_counts':page['logo_inventory']['counts'],
                    'visual_review_status':page['visual_review_status'],'unresolved_image_occurrence_ids':page['unresolved_image_occurrence_ids'],
                    'rights_status':rights,'whole_HTML_archived':False,'open_licence':False,'public_redistribution_permission':'not_established'})
                item.update(status='observed',final_url=response.url)
                existing={p['url'] for p in state['frontier']}
                for link,kind in [(u,'linked_policy') for u in page['policy_links']]+[(u,'relationship_page') for u in page['links']]+[(u,'discovery_page') for u in page.get('discovery_links',[])]:
                    if domain(link)!=job['domain'] or link in existing:continue
                    state['frontier'].append({'url':link,'depth':item['depth']+1,'kind':kind,'status':'pending','discovered_on':response.url});existing.add(link)
                if restrictions:state['status']='publisher_access_hold';held=True;break
            except (SourceBlocked,BudgetExceeded,ValueError) as error:
                item.update(status='access_or_content_review',error=str(error)[:700],checked_at=stamp())
                if 'DNS lookup failed' in str(error):state['status']='network_retry_requires_review'
                elif isinstance(error,BudgetExceeded):state['status']='domain_resource_budget_deferred'
                else:state['status']='publisher_access_hold'
                held=True;break
            state['identity_matches']=sorted(identity);save(path,state)
        if not held:
            state['status']='wave_page_or_depth_limit_frontier_retained' if any(p['status']=='pending' for p in state['frontier']) else 'bounded_discovery_pages_observed'
        state['identity_matches']=sorted(identity);state['updated_at']=stamp();state['full_site_exhausted']=False
        state['invocations'].append({'observed_at':stamp(),'page_attempts':attempted,'max_pages_this_wave':max_pages,'max_depth_this_wave':max_depth,'transport':transport.metrics()})
        save(path,state);return state
    finally:budget.finish(allowance,transport.bytes_fetched)


def read_jobs(path):
    path=Path(path)
    if path.suffix=='.jsonl':
        with path.open() as stream:
            for line in stream:
                if line.strip():yield json.loads(line)
    else:
        data=json.loads(path.read_text())
        yield from data['jobs'] if isinstance(data,dict) else data


def load_states(output):
    for path in (output/'domains').glob('*.json'):yield json.loads(path.read_text())


def export_derived(output,jobs):
    """Small streamed derived outputs, no inventory or company merge."""
    guard(output);counts=Counter();claims=0;leads={};page_count=0;requests=0;body_bytes=0;frontier=0;http_domains=0;page_domains=0;initial_pending=0;unknown_meters=0
    visual_count=0;legacy_unaudited=0
    with (output/'relationship-claims.jsonl.tmp').open('w') as stream,(output/'visual-review-queue.jsonl.tmp').open('w') as visual:
        for state in load_states(output):
            counts[state['status']]+=1;page_count+=len(state['pages']);page_domains+=bool(state['pages'])
            for page in state['pages']:
                if not page.get('logo_inventory_file'):legacy_unaudited+=1
                if page.get('visual_review_status')=='visual_review_pending':
                    visual.write(json.dumps({'domain':state['domain'],'source_url':page['url_final'],'page_content_sha256':page['content_sha256'],
                        'logo_inventory_file':page['logo_inventory_file'],'logo_inventory_sha256':page['logo_inventory_sha256'],
                        'status':'visual_review_pending','reason':'Unresolved or filename-only image evidence on relationship page','market_completeness_verified':False})+'\n');visual_count+=1
            frontier+=sum(p['status']=='pending' and p['kind']!='initial_site' for p in state['frontier'])
            initial_pending+=sum(p['status']=='pending' and p['kind']=='initial_site' for p in state['frontier'])
            http_domains+=any((i['transport']['requests'] or 0)>0 for i in state['invocations'])
            for invocation in state['invocations']:
                requests+=invocation['transport']['requests'] or 0;body_bytes+=invocation['transport']['bytes_fetched'] or 0
                unknown_meters+=invocation['transport']['requests'] is None or invocation['transport']['bytes_fetched'] is None
            pending_policies=any(p['kind']=='linked_policy' and p['status']!='observed' for p in state['frontier'])
            current_rights='manual_or_publisher_hold' if state['status'] in ('manual_review_hold','publisher_access_hold') else 'linked_policy_review_pending' if pending_policies else 'limited_factual_review_only_no_open_licence'
            for claim in state['claims']:
                projected={**claim,'current_domain_reuse_review_status':current_rights,'manual_review_overlay':state.get('manual_review'),
                    'eligible_for_canonical_relationship_promotion':False}
                stream.write(json.dumps(projected,ensure_ascii=False)+'\n');claims+=1
                key=identifier(claim['target_company_or_association_label'],claim.get('target_website'))
                lead=leads.setdefault(key,{'lead_id':key,'published_label':claim['target_company_or_association_label'],'candidate_website':claim.get('target_website'),
                    'candidate_domain':claim.get('target_domain'),'source_claim_observation_ids':[],'entity_kind':'unresolved_related_publisher_label',
                    'organisation_created':False,'merged_with_inventory':False,'service_footprint_status':'unknown','legal_identity_verified':False})
                lead['source_claim_observation_ids'].append(claim['observation_id'])
    (output/'relationship-claims.jsonl.tmp').replace(output/'relationship-claims.jsonl')
    (output/'visual-review-queue.jsonl.tmp').replace(output/'visual-review-queue.jsonl')
    with (output/'new-company-lead-review-queue.jsonl.tmp').open('w') as stream:
        for lead in leads.values():stream.write(json.dumps(lead,ensure_ascii=False)+'\n')
    (output/'new-company-lead-review-queue.jsonl.tmp').replace(output/'new-company-lead-review-queue.jsonl')
    report={'version':VERSION,'updated_at':stamp(),'seeded_domain_jobs':len(jobs),'domains_with_state_receipt':sum(counts.values()),
        'domains_with_actual_HTTP_attempts':http_domains,'domains_with_public_pages_observed':page_domains,
        'domains_without_HTTP_attempt_or_manual_hold':len(jobs)-http_domains-counts['manual_review_hold'],
        'queued_initial_pages_unvisited':initial_pending,'domain_status_counts':dict(counts),'source_pages_observed':page_count,
        'raw_publisher_claim_observations':claims,'verified_relationships':0,'new_related_label_review_leads':len(leads),'discovered_unvisited_frontier_pages':frontier,
        'visual_review_pending_pages':visual_count,'historical_pages_without_logo_inventory':legacy_unaudited,
        'requests_known_total':requests,'bytes_known_total':body_bytes,'interrupted_invocations_with_unknown_resource_meters':unknown_meters,
        'resource_totals_are_lower_bounds_when_unknown_invocations_exist':bool(unknown_meters),'main_database_writes':0,'outreach_messages_sent':0,
        'full_site_exhaustion_claimed':False,'market_completeness_verified':False,'claims_sha256':digest(output/'relationship-claims.jsonl'),
        'limitations':['Publisher directional claims and logo associations are unverified, not contracts, ownership or purchasing authority.',
                      'Source and target legal identities and current relationships remain unverified.',
                      'All discovered unvisited links remain in domain frontier; page/depth budget does not exhaust a website.',
                      'Short factual context and page hashes only; no whole HTML archive, named-person enrichment or canonical company merge.']}
    save(output/'status.json',report);return report


def run(plan,output,overlay_path,*,wave_domains=64,workers=4,max_pages=3,max_depth=1,continuous=False,retry_local_dns=False):
    output=Path(output);output.mkdir(parents=True,exist_ok=True);guard(output)
    with (output/'collector.lock').open('a') as lock:
        try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:raise RuntimeError('Relationship output already has an active collector')
        if retry_local_dns:
            for path in (output/'domains').glob('*.json'):
                state=json.loads(path.read_text())
                if state['status']=='network_retry_requires_review':
                    for item in state['frontier']:
                        if 'DNS lookup failed' in item.get('error',''):
                            state.setdefault('local_DNS_review_attempts',[]).append(dict(item));item.update(status='pending');item.pop('error',None)
                    state['status']='queued_after_local_DNS_review';save(path,state)
        return _run(plan,output,overlay_path,wave_domains=wave_domains,workers=workers,max_pages=max_pages,max_depth=max_depth,continuous=continuous)


def _run(plan,output,overlay_path,*,wave_domains,workers,max_pages,max_depth,continuous):
    output=Path(output);output.mkdir(parents=True,exist_ok=True);(output/'domains').mkdir(exist_ok=True);guard(output)
    jobs=list(read_jobs(plan));byid={job['job_id']:job for job in jobs}
    if len(byid)!=len(jobs) or len({job['domain'] for job in jobs})!=len(jobs):raise ValueError('Domain job plan repeats IDs/domains')
    if not 1<=wave_domains<=1000 or not 1<=workers<=4 or not 1<=max_pages<=20 or not 0<=max_depth<=4:raise ValueError('Explicit bounded wave parameters required')
    overlay=json.loads(Path(overlay_path).read_text()) if overlay_path else {'reviews':{}}
    order=sorted(jobs,key=lambda j:(FOCUS.index(j['domain']) if j['domain'] in FOCUS else len(FOCUS),-int(j['job_id'][:12],16)))
    save(output/'seed-manifest.json',{'version':VERSION,'source_plan':str(plan),'source_plan_sha256':digest(plan),'all_domain_jobs_seeded':len(jobs),
        'all_job_ids':[job['job_id'] for job in order],'initial_focus_domains':FOCUS,'manual_review_overlay':str(overlay_path),
        'manual_review_overlay_sha256':digest(overlay_path) if overlay_path else None,'max_pages_per_domain_wave':max_pages,
        'max_depth_current_wave':max_depth,'workers':workers,'whole_site_limit':None,'full_site_exhaustion_claimed':False})
    wave=0
    while True:
        if (output/'pause-requested').exists():break
        guard(output);pending=[]
        for position,job in enumerate(order):
            path=output/'domains'/(job['job_id']+'.json')
            state=json.loads(path.read_text()) if path.exists() else None
            if state is None or eligible(state,max_depth):
                prior_attempt_waves=sum(i['page_attempts']>0 for i in state['invocations']) if state else 0
                pending.append((prior_attempt_waves,position,job))
        if not pending:break
        # First visit all seed domains before consuming another page budget on
        # an already visited domain with a large retained frontier.
        pending.sort(key=lambda item:(item[0],item[1]))
        selected=[item[2] for item in pending[:wave_domains]];wave+=1;budget=WaveBudget();storage_paused=False;deferred=0
        save(output/'active-wave-selection.json',{'wave':wave,'selected_at':stamp(),'domains':[{'job_id':job['job_id'],'domain':job['domain']} for job in selected],
            'workers':workers,'max_pages_per_domain_wave':max_pages,'max_depth':max_depth,'body_byte_budget':budget.maximum})
        with ThreadPoolExecutor(max_workers=workers) as pool:
            futures={pool.submit(observe_domain,job,output,overlay,budget,max_pages=max_pages,max_depth=max_depth):job for job in selected}
            for future in as_completed(futures):
                job=futures[future]
                try:
                    result=future.result();deferred+=result['status']=='wave_resource_budget_deferred'
                    print(json.dumps({'stage':'relationship_observation','wave':wave,'domain':job['domain'],'status':result['status'],
                        'pages_total':len(result.get('pages',[])),'raw_claims_total':len(result.get('claims',[]))}),flush=True)
                except StorageHold as error:storage_paused=True;print(json.dumps({'status':'storage_paused','domain':job['domain'],'reason':str(error)}),flush=True)
        if storage_paused:print(json.dumps({'status':'storage_paused','queued_jobs_preserved':True,'every_worker_checks_storage_before_each_fetch':True}),flush=True);break
        report=export_derived(output,jobs);print(json.dumps(report),flush=True)
        if not continuous or deferred==len(selected):break
    return export_derived(output,jobs)


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--plan',required=True);parser.add_argument('--output',required=True);parser.add_argument('--overlay')
    parser.add_argument('--wave-domains',type=int,default=64);parser.add_argument('--workers',type=int,default=4);parser.add_argument('--max-pages',type=int,default=3)
    parser.add_argument('--max-depth',type=int,default=1);parser.add_argument('--continuous',action='store_true');parser.add_argument('--retry-local-dns',action='store_true');args=parser.parse_args()
    try:run(args.plan,args.output,args.overlay,wave_domains=args.wave_domains,workers=args.workers,max_pages=args.max_pages,max_depth=args.max_depth,continuous=args.continuous,retry_local_dns=args.retry_local_dns)
    except StorageHold as error:print(json.dumps({'status':'storage_paused','reason':str(error),'no_main_database_writes':True}),flush=True)
