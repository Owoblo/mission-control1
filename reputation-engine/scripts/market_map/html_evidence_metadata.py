"""Deterministic metadata candidates from already captured HTML; no fetching or inference."""
import hashlib
import json
from lxml import etree, html


def extract_metadata(body, source_url, *, max_input_bytes=2*1024*1024,
                     max_records=200, max_text_chars=1000, max_json_chars=20000,
                     max_output_bytes=150000):
    if not isinstance(body, bytes) or not isinstance(source_url, str) or not source_url:
        raise ValueError('Captured bytes and source URL required')
    for value in (max_input_bytes,max_records,max_text_chars,max_json_chars,max_output_bytes):
        if type(value) is not int or value < 1:raise ValueError('Positive integer limits required')
    digest=hashlib.sha256(body).hexdigest()
    report={'source_url':source_url,'raw_sha256':digest,'extractor_version':1,
            'records':[],'rejected':[],'truncated':False,'truncation_reasons':[],
            'verification_status':'evidence_candidates_only',
            'text_semantics':'DOM text excluding script/style, not browser-computed visibility'}
    if len(body)>max_input_bytes:raise ValueError('Input exceeds byte budget; body not truncated')
    if max_output_bytes < len(json.dumps(report).encode())+256:raise ValueError('Output budget too small for receipt')
    def flag(reason):
        report['truncated']=True
        if reason not in report['truncation_reasons']:report['truncation_reasons'].append(reason)
    def text(value):
        value=' '.join((value or '').split())
        if len(value)>max_text_chars:flag('text_chars');return value[:max_text_chars],True
        return value,False
    def add(kind,fields,section='records'):
        if len(report['records'])+len(report['rejected'])>=max_records:flag('record_count');return
        row={'kind':kind,'source_url':source_url,'raw_sha256':digest,'verification_status':'candidate',**fields}
        report[section].append(row)
        if len(json.dumps(report,ensure_ascii=False).encode())+256>max_output_bytes:
            report[section].pop();flag('output_bytes')
    try:tree=html.fromstring(body,parser=html.HTMLParser(no_network=True))
    except (etree.ParserError,ValueError):
        add('html',{'reason':'parse_error'},'rejected');return report
    # Parse structured publisher statements before removing scripts from DOM text.
    for node in tree.xpath('//script'):
        if (node.get('type') or '').split(';')[0].strip().lower()!='application/ld+json':continue
        raw=node.text or '';position=tree.getroottree().getpath(node)
        if len(raw)>max_json_chars:
            flag('json_chars');add('json_ld',{'element_path':position,'reason':'over_json_budget'},'rejected');continue
        try:
            def constant(_):raise ValueError('Nonstandard JSON constant')
            obj=json.loads(raw,parse_constant=constant)
            if not isinstance(obj,(dict,list)):raise ValueError('Expected object or array')
        except (ValueError,RecursionError):
            add('json_ld',{'element_path':position,'reason':'malformed_or_nonobject_json'},'rejected');continue
        add('json_ld',{'element_path':position,'raw_json':raw,'parsed':obj,'truncated':False})
    for node in tree.xpath('//script|//style'):node.drop_tree()
    for node in tree.iter():
        if not isinstance(node.tag,str):continue
        tag=node.tag.lower();position=tree.getroottree().getpath(node)
        if tag in ('title','h1','h2'):
            value,cut=text(node.text_content());add(tag,{'text':value,'truncated':cut,'element_path':position})
        if tag=='a':
            href=node.get('href') or '';scheme=href.strip().split(':',1)[0].lower()
            if scheme in ('mailto','tel'):
                value,cut=text(href);label,labelcut=text(node.text_content())
                parent=node.getparent();context,contextcut=text(parent.text_content() if parent is not None else node.text_content())
                add('contact_link',{'channel':scheme,'href':value,'label':label,'dom_context':context,
                    'element_path':position,'truncated':cut or labelcut or contextcut})
        if tag=='img':
            alt,cut=text(node.get('alt'));src,srccut=text(node.get('src'))
            add('image',{'alt':alt,'src':src,'element_path':position,'truncated':cut or srccut,
                         'relationship_inferred':False})
    return report
