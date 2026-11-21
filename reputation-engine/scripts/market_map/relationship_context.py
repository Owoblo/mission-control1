"""Evidence-scoped relationship context; navigation and people are not companies."""
from __future__ import annotations
import re
from urllib.parse import urlsplit

ROLE_WORDS=r'clients|customers|partners|suppliers|dealers|brands|sponsors|members|tenants|partenaires|fournisseurs|marques|commanditaires'
ROSTER_PATH=re.compile(r'(?:^|/)(?:(?:our|nos)[-_])?(?:'+ROLE_WORDS+r')(?:[-_/.]|$)',re.I)
ROSTER_HEADING=re.compile(r'^(?:(?:our|nos)\s+)?(?:'+ROLE_WORDS+r')(?:\s*[-:|–—].*)?$',re.I)
CTA=re.compile(r'^(?:get (?:your project )?started|start (?:my|your|a)\b.*|submit\b.*request|request (?:a )?(?:quote|consultation|callback)|leave (?:a )?review|review us|write (?:a )?review|book\b.*(?:appointment|consultation)|contact\s+(?:us|service\b.*))$',re.I)
SERVICE_PATH=re.compile(r'/(?:register|registration|sign[-_]?up|sign[-_]?in|login|log[-_]?in|account|dashboard|book[-_]?online)(?:[/.]|$)',re.I)
PERSONAL_ROLE=re.compile(r'\bmember of parliament\b|\b(?:his|her|he|she|my)\b.{0,240}\b(?:director|chair|council|committee|member|executive|trustee)\b|\b(?:director|chair|council|committee|member|executive|trustee)\b.{0,160}\b(?:his|her|he|she)\b',re.I)
PERSONAL_PAGE=re.compile(r'/(?:team|people|biograph(?:y|ies)|bio|our-lawyers|lawyers)/',re.I)
INFORMATION=re.compile(r'^(?:map\s*:|contact service\b|.*electoral district.*|.*constituency profile.*|.*voting information.*)$',re.I)
TESTIMONIAL=re.compile(r'testimonials?|reviews?|what (?:our )?customers say',re.I)


def host(url):
    return (urlsplit(url or '').hostname or '').lower().removeprefix('www.')


def same_publisher(source,target):
    left,right=host(source),host(target)
    return bool(left and right and (left==right or left.endswith('.'+right) or right.endswith('.'+left)))


def utility_reason(label,url,source_url=None):
    value=(label or '').strip();parsed=urlsplit(url or '');target=host(url);path=parsed.path
    if CTA.fullmatch(value):return 'conversion_or_navigation_CTA'
    if (target=='trustpilot.com' or target.endswith('.trustpilot.com')) and re.match(r'^/(?:review|evaluate)/',path,re.I):return 'consumer_review_route'
    if target=='review.nps.today' or target.endswith('.review.nps.today'):return 'review_request_service'
    if target=='hsforms.com' or target.endswith('.hsforms.com'):return 'hosted_form_service'
    if target in {'form.jotform.com','forms.jotform.com'} or (target=='jotform.com' and re.match(r'^/(?:\d|form/)',path)):return 'hosted_form_service'
    if (target=='typeform.com' or target.endswith('.typeform.com')) and (path.startswith('/to/') or target.startswith('form.')):return 'hosted_form_service'
    if (target=='formstack.com' or target.endswith('.formstack.com')) and ('/forms/' in path or target.startswith('forms.')):return 'hosted_form_service'
    if source_url and same_publisher(source_url,url):return 'self_publisher_link_requires_entity_review'
    if SERVICE_PATH.search(path):return 'registration_or_account_service_route'
    return None


def explicit_local_relation(claim):
    """Require the linked target beside a relation phrase, not elsewhere in a bio."""
    label=claim.get('target_company_or_association_label') or ''
    context=claim.get('anchor_local_context') or claim.get('short_context') or ''
    target=re.escape(label).replace(r'\ ',r'\s+')
    if not target:return False
    # Corporate membership needs an organisation subject. A person's past board
    # role cannot become a relationship of the business publishing their bio.
    subject=claim.get('source_company_label') or ''
    actors=r'we|our\s+(?:company|organisation|organization|office|firm)'
    if subject:actors+='|'+re.escape(subject)
    patterns=[r'\b(?:partner(?:s|ed|ing|ship)?|work(?:s|ed|ing)?|collaborat(?:e|es|ed|ing))\s+with\s+(?:the\s+)?'+target,
              r'\b(?:our|project|end)\s+(?:client|customer|supplier|dealer|partner)\s*[:–—-]?\s*(?:the\s+)?'+target,
              target+r'.{0,60}\b(?:is|are)\s+(?:our\s+)?(?:client|customer|supplier|dealer|partner)\b',
              r'\b(?:'+actors+r')\b.{0,80}\b(?:member(?:s)? of|subsidiary of|sponsor(?:s|ing)?(?: of)?)\s+(?:the\s+)?'+target]
    return any(re.search(pattern,context,re.I) for pattern in patterns)


def context_support(claim):
    context=claim.get('anchor_local_context') or claim.get('short_context') or ''
    source_url=claim['source_page_url'];title=claim.get('source_page_title','')
    if PERSONAL_ROLE.search(context) or (PERSONAL_PAGE.search(urlsplit(source_url).path) and re.search(r'\bdirector|\bchair|\bmember of',context,re.I)):
        return 'personal_role_not_organisation_relationship'
    if INFORMATION.fullmatch(claim.get('target_company_or_association_label','')):return 'information_or_navigation_link'
    if explicit_local_relation(claim) or claim.get('saved_explicit_statement_evidence_verified'):return 'explicit_target_bound_local_claim'
    # Testimonials are not rosters of every external company linked on a page.
    if TESTIMONIAL.search(urlsplit(source_url).path+' '+title):return 'testimonial_page_context_not_target_relationship'
    heading=(claim.get('local_relationship_heading') or '').strip()
    if heading and ROSTER_HEADING.fullmatch(heading):return 'local_relationship_roster_heading'
    if ROSTER_PATH.search(urlsplit(source_url).path):return 'dedicated_relationship_roster_page'
    title_start=title.split('|',1)[0].strip()
    if ROSTER_HEADING.fullmatch(title_start):return 'dedicated_relationship_roster_title'
    # Legacy logo receipts retain the local collection statement, even when the
    # original parser did not retain its DOM heading separately.
    if claim.get('logo_only') and re.match(r'^\s*(?:our|nos)\s+(?:'+ROLE_WORDS+r')\b',context,re.I):return 'local_logo_collection_statement'
    return 'target_bound_relationship_context_not_established'
