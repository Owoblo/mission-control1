"""Offline evidence-scoped route assessment; publication is never employment proof."""
import hashlib
import re
import unicodedata
from .contact_context import extract_contact_context


def norm(value):return ' '.join(unicodedata.normalize('NFC',str(value or '')).casefold().split())

def assess_scoped_person_route(email,candidates,body,url,expected_hash):
    raw=body.encode() if isinstance(body,str) else body
    if hashlib.sha256(raw).hexdigest()!=expected_hash:raise ValueError('capture hash mismatch')
    people=extract_contact_context(raw,url)['people']
    matches=[]
    for person in people:
        if email not in person['emails']:continue
        if person.get('source_listing_kind')=='board_or_advisory_listing' or re.search(r'\b(former|retired|advisor|advisory|board)\b',person['role_title'],re.I):continue
        if not person.get('source_dom_locator'):continue
        for candidate in candidates:
            if norm(person['name'])==norm(candidate.get('recipient_name')) and norm(person['role_title'])==norm(candidate.get('recipient_role')):
                matches.append({'candidate':candidate,'evidence':person})
    identities={(norm(c.get('recipient_name')),norm(c.get('recipient_role'))) for c in candidates}
    scopes={(m['evidence']['source_dom_locator'],m['evidence'].get('structured_evidence',{}).get('node_pointer')) for m in matches}
    supported=len(identities)==1 and len(scopes)==1 and bool(matches)
    return {'role_supported':supported,'reason':'same_scoped_person_email_role' if supported else 'ambiguous_or_missing_scoped_person_role',
            'candidate_people':candidates,'scoped_matches':matches,'page_content_sha256':expected_hash,'auto_send':False}
