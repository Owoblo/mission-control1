"""Adapter for current pure extractors. Never infers owners from labels or website hosts."""
import hashlib
from .contact_page import parse_contact_page
from .email_extraction import extract_published_emails

def replay(manifest,bodies):
    results={}
    for page in manifest['captures']:
        if hashlib.sha256(bodies[page['id']]).hexdigest()!=page['sha256']:raise ValueError('replay body hash mismatch')
        receipt={'url':page['url'],'sha256':page['sha256'],'captured_at':page['captured_at']}
        if page['source_kind']=='document':
            results[page['id']]={'capture_sha256':page['sha256'],'versions':{'adapter':'release-replay/1'},'observations':[],'entities':[],'diagnostics':[{'stage':'parsing','status':'unsupported','reason':'No document parser in approved extraction path'}]};continue
        parsed=parse_contact_page(bodies[page['id']],receipt);rows=[];diagnostics=[]
        extract_published_emails(bodies[page['id']],page['url'],candidate_evidence=diagnostics)
        for channel,key in [('email','emails'),('phone','phones')]:
            for summary in parsed[key]:
                for occurrence in summary.get('occurrences') or [summary]:
                    rows.append({'id':str(len(rows)),'channel':channel,'normalized':summary[channel],
                       'status':'accepted','raw':occurrence.get('raw_value') or summary.get('raw_value'),
                       'locator':occurrence.get('source_dom_locator') or summary.get('source_dom_locator'),
                       'method':occurrence.get('extraction_method') or summary.get('extraction_method'),
                       'version':summary.get('extraction_version'),'capture_sha256':page['sha256'],'source_url':page['url'],
                       'kind':summary.get('kind'),'extension':summary.get('extension'),
                       'ownership':'unknown','owners':[],'source_occurrence':occurrence})
        for diagnostic in diagnostics:
            if diagnostic.get('status') in {'unsupported','invalid'}:
                rows.append({'id':str(len(rows)),'channel':'email','status':diagnostic['status'],'raw':diagnostic.get('raw_value'),'locator':diagnostic.get('source_dom_locator'),'normalized':None,'ownership':'unknown','owners':[]})
        # Context edges are kept as document-scoped person assertions, never company identities.
        for person in parsed['context'].get('people',[]):
            locator=person.get('source_dom_locator') or person.get('evidence',{}).get('source_dom_locator')
            for row in rows:
                if row['channel']=='email' and row['normalized'] in person.get('emails',[]) and locator and row['locator'] and row['locator'].startswith(locator+'/'):
                    row['owners'].append({'type':'person','id':'person:'+locator+':'+person['name'],'status':'asserted'});row['ownership']='supported'
        results[page['id']]={'capture_sha256':page['sha256'],'versions':parsed['parser_versions'],'observations':rows,'entities':[],
          'diagnostics':diagnostics+[{'stage':k,'error':v} for k,v in parsed['parser_errors'].items()],
          'unprojected_context':parsed['context'],'unprojected_structured':parsed['structured_contacts']}
    return results
