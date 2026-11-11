"""Evidence-backed contact context; published titles are not purchasing authority."""
from .structured_contacts import walk_contact_graph
import hashlib
import json
import re
from urllib.parse import urlsplit
from lxml import html
from .email_extraction import extract_published_emails, clean_email, role_hint
from .relationships import canonical_url

VERSION = 'ssm-contact-context/2'

ROLE_RULES = [
 ('facilities',r'\bfacilit(?:y|ies)\b'),
 ('procurement',r'\bprocurement|purchasing|sourcing\b'),
 ('property_management',r'\bproperty manag|building manag|real estate director'),
 ('office_admin',r'\boffice manag|office administr|administrative director|administration manager'),
 ('hr_people',r'\bhuman resources|\bHR\b|people (?:operations|manager|director)|talent acquisition'),
 ('project_construction',r'\bproject manag|construction manag|site supervisor'),
 ('operations',r'\boperations|\bCOO\b|chief operating'),
 ('sales_partnerships',r'\bsales|partnerships|business development'),
 ('owner_executive',r'\bowner|founder|\bCEO\b|chief executive|president|executive director|managing director'),
]
ROLE_TITLE = re.compile(r'\b(?:manager|director|president|owner|founder|chief|CEO|COO|CFO|officer|head|supervisor|coordinator|administrator|partner)\b',re.I)
EXCLUDED = re.compile(r'testimonial|customer.review|vacanc|job.post|careers|recruitment|job.opening|author.bio|blog.author',re.I)
GENERIC_NAMES = re.compile(r'\b(?:team|staff|leadership|contact|about|services|partners|management|department|company|corporation|group|welcome|office|career|director|manager|officer|president|owner|founder|human|resources)\b',re.I)
INBOX_FUNCTIONS = {'procurement':'procurement','purchasing':'procurement','vendors':'procurement','suppliers':'procurement','facilities':'facilities','maintenance':'facilities','operations':'operations','hr':'hr_people','humanresources':'hr_people','people':'hr_people','office':'office_admin','admin':'office_admin','reception':'office_admin','sales':'sales_partnerships','partnerships':'sales_partnerships','info':'general_business','contact':'general_business','hello':'general_business','ceo':'owner_executive','president':'owner_executive','owner':'owner_executive','founder':'owner_executive','cfo':'owner_executive','coo':'operations','management':'unknown','accounts':'unknown','accounting':'unknown','support':'general_business','careers':'hr_people','jobs':'hr_people'}
RELEVANT = re.compile(r'team|leadership|management|about|contact|procurement|vendors?|suppliers?|locations?|staff',re.I)


def role_function(title):
    return next((name for name,pattern in ROLE_RULES if re.search(pattern,title,re.I)),'unknown')


def person_name(value):
    value=' '.join(str(value or '').split())
    parts=value.split()
    return value if 2<=len(parts)<=5 and len(value)<=100 and not GENERIC_NAMES.search(value) and all(re.fullmatch(r"[^\W\d_][^\W\d_'.’\-]*\.?",p,re.U) for p in parts) else None



def explicit_company_description(text):
    """Require an actual company/business noun phrase, not an event or product."""
    text=' '.join(str(text).split())
    # Self-description requires an article. Named subjects retain case as evidence;
    # pronouns and subordinate clauses cannot become unnamed company subjects.
    subject=r"(?:(?i:we are|we['’]re)|[A-Z0-9][\w&'’.-]*(?: [\w&'’.-]+){0,7} (?i:is))"
    match=re.match(subject+r" (?i:a|an) (?P<description>[\w&'’\- ]{0,100}?)\b(?i:company|business)\b(?P<after>.*)$",text)
    if not match:return False
    if re.match(r'(?i:it|this|that|there|whether|what|which|our product|our software)\b',text):return False
    after=match.group('after').strip()
    return not after or bool(re.match(r"^[.,;:!)]|^(?i:that|which|based|speciali[sz]ing|serving|providing|offering|with|in|and|operating)\b",after))


def listing_context(heading):
    """Nearest preceding section heading, separately from a person's job title."""
    level=int(heading.tag[1]) if isinstance(heading.tag,str) and re.fullmatch(r'h[1-6]',heading.tag) else 4
    for node in reversed(heading.xpath('preceding::*[self::h1 or self::h2 or self::h3 or self::h4 or self::h5 or self::h6]')):
        if int(node.tag[1])>level:continue
        value=' '.join(node.text_content().split())
        if value and len(value)<=180 and (not person_name(value) or re.search(r'board|staff|leadership|team|directors|advisory|council',value,re.I)):
            return value
    return None


def extract_contact_context(body,url,*,email_summaries=None):
    data=body.encode() if isinstance(body,str) else body
    output={'organisation_assertions':[],'people':[],'department_contacts':[],'relevant_links':[]}
    if not data:return output
    document=html.fromstring(data.decode('utf-8',errors='replace'),base_url=url);digest=hashlib.sha256(data).hexdigest()
    def evidence(excerpt,method):
        return {'source_url':url,'page_content_sha256':digest,'excerpt':' '.join(str(excerpt).split())[:700],
                'extraction_version':VERSION,'extraction_method':method,'review_status':'source_published_candidate_requires_review'}
    original_paths={n:document.getroottree().getpath(n) for n in document.iter()}
    original_emails=extract_published_emails(data,url) if email_summaries is None else email_summaries
    people_seen=set()
    def add_person(name,title,emails,excerpt,method,employer=None,source_listing_context=None,scope=None):
        name=person_name(name)
        if not name or not isinstance(title,str) or not title.strip() or len(title)>160:return
        values=sorted({v for v in (clean_email(str(x).removeprefix('mailto:')) for x in emails) if v})
        # A named card can publish a shared departmental inbox; preserve it elsewhere.
        personal=[v for v in values if v.split('@')[0].lower() not in INBOX_FUNCTIONS and role_hint(v)=='unspecified_published_inbox']
        key=(name,title,tuple(personal),method,scope)
        if key in people_seen:return
        people_seen.add(key)
        output['people'].append({**evidence(excerpt,method),'name':name,'role_title':title.strip(),'role_function':role_function(title),
            'source_dom_locator':scope,'emails':personal if len(personal)==1 else [],'unassigned_published_emails':values if len(personal)!=1 else [v for v in values if v not in personal],
            'email_association_status':'same_unambiguous_public_card_not_verified' if len(personal)==1 else 'not_established',
            'published_employer':employer,'employer_identity_status':'not_verified','employment_relationship_status':'not_established',
            'source_listing_context':source_listing_context,'source_listing_kind':'board_or_advisory_listing' if re.search(r'board|advisory|council',source_listing_context or '',re.I) else 'public_role_listing',
            'authority_scope':'not_established',
            'purchasing_authority_verified':False,'ssm_route_hypothesis':{'role_function':role_function(title),'status':'service_fit_hypothesis_only'}})
    for node in document.xpath('//script[contains(@type,"ld+json")]'):
        try:
            contacts=walk_contact_graph(json.loads(node.text or ''))
            for person in contacts:
                if person['channel']!='person':continue
                emails=[r['value'] for r in contacts if r['channel']=='email' and r['node_pointer']==person['node_pointer']]
                employers=person['candidate_employers']
                employer=employers[0]['name'] if len(employers)==1 else None
                before=len(output['people'])
                add_person(person['value'],person['job_title'],emails if not person['ambiguity_review_required'] else [],json.dumps(person['node']), 'json_ld_person_role',employer,scope=original_paths[node]+'#'+person['node_pointer'])
                if len(output['people'])>before:
                    output['people'][-1]['structured_evidence']=person
                    output['people'][-1]['source_dom_locator']=original_paths[node]
        except (ValueError,TypeError,RecursionError):pass
    for node in document.xpath('//script|//style|//noscript|//template|//*[@hidden or @aria-hidden="true"]'):
        if node.getparent() is not None:node.drop_tree()
    for node in document.xpath('//*[@style]'):
        if re.search(r'display\s*:\s*none|visibility\s*:\s*hidden',node.get('style',''),re.I) and node.getparent() is not None:node.drop_tree()
    page_context=' '.join(document.xpath('//title/text()'))+' '+urlsplit(url).path
    for heading in document.xpath('//h1|//h2|//h3|//h4|//*[@itemprop="name"]'):
        name=person_name(heading.text_content())
        if not name:continue
        for card in list(heading.iterancestors())[:3]:
            if card.tag in ('body','html','main'):break
            context=' '.join(card.text_content().split())
            attrs=' '.join((a.get('class','')+' '+a.get('id','')) for a in [card,*card.iterancestors()])
            if EXCLUDED.search(attrs+' '+urlsplit(url).path) or re.search(r'\b(?:we are hiring|apply now|job opening|vacancy|former |retired )',context,re.I):break
            if len(context)>900:break
            if not re.search(r'team|staff|leadership|management|contact|profile|person',attrs+' '+page_context,re.I):continue
            headings=card.xpath('.//h1|.//h2|.//h3|.//h4|.//*[@itemprop="name"]')
            names={person_name(h.text_content()) for h in headings};names.discard(None)
            if names!={name}:continue
            titles=[]
            for node in card.xpath('.//*[@itemprop="jobTitle"]|.//p|.//span|.//div[not(*)]'):
                title=' '.join(node.text_content().split())
                if title and len(title)<=120 and name not in title and ROLE_TITLE.search(title) and '@' not in title and not re.search(r'\b(?:hiring|seeking|vacancy|apply)\b',title,re.I):titles.append(title)
            titles=list(dict.fromkeys(titles))
            if len(titles)!=1:continue
            path=original_paths[card]
            scoped=[o for e in original_emails for o in e.get('occurrences',[]) if o.get('source_dom_locator')==path or (o.get('source_dom_locator') or '').startswith(path+'/')]
            emails=[o['email'] for o in scoped]
            add_person(name,titles[0],emails,context,'visible_role_card',source_listing_context=listing_context(heading),scope=path)
            if output['people'] and output['people'][-1].get('source_dom_locator')==path:output['people'][-1]['email_occurrences']=scoped
            break
    for record in original_emails:
        email=record['email'];local=email.split('@')[0].lower().split('+')[0]
        function=INBOX_FUNCTIONS.get(local)
        context=record.get('short_supporting_context','')
        if not function:
            # Local explicit department text may support a route; a title elsewhere does not.
            if len(context)<=350 and re.search(r'\bdepartment\b',context,re.I):function=role_function(context)
            if function in (None,'unknown'):continue
        output['department_contacts'].append({**evidence(context,'published_inbox_context'),'email':email,'role_function':function,
            'basis':'published_inbox_prefix' if local in INBOX_FUNCTIONS else 'local_department_context','person_name':None,
            'source_association_status':record.get('association_status'),'department_identity_status':'inferred_route_requires_review','mailbox_verified':False,'purchasing_authority_verified':False})
    mains=document.xpath('//main') or document.xpath('//body') or [document]
    patterns=[('nonprofit',r'\b(?:registered charity|not[- ]for[- ]profit|non[- ]profit organisation|non[- ]profit organization)\b'),
              ('association',r'\b(?:trade association|professional association|business association|membership association)\b'),
              ('government_body',r'\b(?:municipal government|government agency|government department)\b'),
              ('franchisee',r'\b(?:independently owned franchise|franchise owner|franchisee)\b'),
              ('company',r'\b(?:we are|we.re|is a|is an)\b.{0,100}\b(?:company|business)\b')]
    seen=set()
    for main in mains:
        for node in main.xpath('.//p'):
            if node.xpath('ancestor::footer|ancestor::nav|ancestor::header'):continue
            text=' '.join(node.text_content().split())
            if len(text)>700 or not re.search(r'\b(?:we are|we.re|our organisation|our organization|is a|is an)\b',text,re.I):continue
            for category,pattern in patterns:
                if (explicit_company_description(text) if category=='company' else re.search(pattern,text,re.I)) and (category,text) not in seen:
                    seen.add((category,text));output['organisation_assertions'].append({**evidence(text,'explicit_description_candidate'),
                       'taxonomy':'entity_type','category':category,'organisation_size_band':'unknown','organisation_scope':'parent_branch_or_single_entity_not_established','publisher_attribution':'requires_review'})
    host=(urlsplit(url).hostname or '').removeprefix('www.')
    links=set()
    for a in document.xpath('//a[@href]'):
        href=a.get('href','');target=canonical_url(href,url)
        if target and (urlsplit(target).hostname or '').removeprefix('www.')==host and RELEVANT.search(href+' '+a.text_content()):links.add(target)
    output['relevant_links']=sorted(links)
    return output
