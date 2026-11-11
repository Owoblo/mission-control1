"""Pure fan-out of one immutable capture. No fetches, storage, ownership promotion."""
import hashlib,json
from lxml import html
from . import email_extraction,phone_extraction,contact_context,structured_contacts
from .contact_frontier import score_contact_link
from .relationships import canonical_url

VERSION='ssm-contact-page/1'

def parser_versions():
    return {'email':email_extraction.VERSION,'phone':phone_extraction.VERSION,'context':contact_context.VERSION,
            'structured':structured_contacts.VERSION,'page':VERSION}

def parse_contact_page(body,receipt,*,email_parser=None,phone_parser=None,context_parser=None):
    if not isinstance(body,bytes):raise TypeError('Captured bytes required')
    digest=hashlib.sha256(body).hexdigest()
    if digest!=receipt['sha256']:raise ValueError('capture hash mismatch')
    url=receipt['url'];versions=parser_versions()
    result={'capture':dict(receipt),'page_content_sha256':digest,'parser_versions':versions,'parser_errors':{},
            'emails':[],'phones':[],'context':{},'structured_contacts':[],'frontier_candidates':[],
            'charset':receipt.get('charset'),'decoding_uncertainty':False,'source_fetches':0,'send_ready':False}
    try:body.decode('utf-8')
    except UnicodeError:result['decoding_uncertainty']=True
    for name,parser in [('email',email_parser or email_extraction.extract_published_emails),('phone',phone_parser or phone_extraction.extract_published_phones)]:
        try:result['emails' if name=='email' else 'phones']=parser(body,url)
        except Exception as error:result['parser_errors'][name]={'type':type(error).__name__,'message':str(error)[:300]}
    try:result['context']=(context_parser or contact_context.extract_contact_context)(body,url,email_summaries=result['emails'])
    except Exception as error:result['parser_errors']['context']={'type':type(error).__name__,'message':str(error)[:300]}
    try:
        doc=html.fromstring(body,base_url=url)
        for script in doc.xpath('//script[@type="application/ld+json"]'):
            pointer=doc.getroottree().getpath(script)
            try:
                for row in structured_contacts.walk_contact_graph(json.loads(script.text or '')):
                    result['structured_contacts'].append({**row,'source_dom_locator':pointer,'source_url':url,'page_content_sha256':digest})
            except (ValueError,TypeError,RecursionError) as error:result['parser_errors']['structured:'+pointer]={'type':type(error).__name__,'message':str(error)[:300]}
        for anchor in doc.xpath('//a[@href]'):
            label=' '.join(anchor.text_content().split());target=canonical_url(anchor.get('href'),url)
            if target and score_contact_link(target,label)>0:result['frontier_candidates'].append({'url':target,'label':label,'source_dom_locator':doc.getroottree().getpath(anchor)})
    except Exception as error:result['parser_errors']['document']={'type':type(error).__name__,'message':str(error)[:300]}
    return result
