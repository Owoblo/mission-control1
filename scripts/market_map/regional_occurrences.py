"""Carry regional candidates separately from observed document evidence."""
import hashlib
import json
import unicodedata


def norm(value):
    return ' '.join(unicodedata.normalize('NFC',str(value or '')).casefold().split())


def evidence_for_page(page, records):
    candidates=[dict(r) for r in records]
    output=[]
    for channel,observations in [('email',page.get('emails',[])),('phone',page.get('phones',[]))]:
        for observation in observations:
            for occurrence in observation.get('occurrences') or [observation]:
                evidence=dict(occurrence)
                complete=bool(evidence.get('page_content_sha256') and evidence.get('source_dom_locator'))
                oid=evidence.get('occurrence_id') or hashlib.sha256(json.dumps([channel,page['url'],evidence],sort_keys=True).encode()).hexdigest()
                owner=evidence.get('candidate_owner') or evidence.get('structured_evidence') or {}
                owners=owner.get('candidate_owners',[])
                vendor='vendor' in evidence.get('association_status','')
                supported=[]
                if complete and not vendor and owner.get('ownership_status')=='explicit_document_edge_not_verified' and len(owners)==1:
                    matches=[r for r in records if norm(r.get('organization'))==norm(owners[0].get('name')) and norm(owners[0].get('name'))]
                    # A brand name alone cannot select between source branches.
                    if len({r['source_record_id'] for r in matches})==1:supported=[matches[0]['source_record_id']]
                output.append({'occurrence_id':oid,'channel':channel,'value':evidence.get(channel,observation.get(channel)),
                    'source_url':page['url'],'source_evidence':evidence,'candidate_source_records':candidates,
                    'document_supported_candidate_record_ids':supported,'relationship_status':'candidate_only_not_verified',
                    'evidence_status':'occurrence_evidence' if complete else 'attribution_evidence_incomplete',
                    'vendor_review_required':vendor,'send_ready':False})
    return output
