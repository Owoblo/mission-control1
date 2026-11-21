"""Published phone evidence; format normalization is not line or owner verification."""
import hashlib
import json
import re
from lxml import html
from .structured_contacts import walk_contact_graph
from .contact_text_runs import iter_contact_text_runs, hidden
from .contact_normalization import EXT, PHONE_NORMALIZATION_VERSION, parse_phone_candidate

VERSION = 'ssm-published-phone-extraction/4'
NANP = re.compile(r'(?<![\w\d])(?:\+?1[ .-]?)?(?:\([2-9]\d{2}\)[ .-]*|[2-9]\d{2}[ .-]+)[2-9]\d{2}[ .-]\d{4}(?:\s*(?:ext(?:ension)?\.?|x|#)\s*\d{1,10})?(?!\d)',re.I)
LABELLED = re.compile(r'\b(?:phone|tel(?:ephone)?|call|fax)\s*[:.]?\s*(\+?\d[\d ()+.-]{6,24}(?:\s*(?:ext(?:ension)?\.?|x|#)\s*\d{1,10})?)',re.I)

_BLOCKS = {'p', 'div', 'li', 'tr', 'section', 'article', 'header', 'footer', 'address', 'dt', 'dd', 'form', 'main', 'body', 'html'}
_LABEL = r'\b(?:fax|phone|telephone|tel|call)\b'
_LABEL_RUN = r'(?P<labels>(?:' + _LABEL + r'[\s:/&(),.\-]*)+)'


def classify_phone_occurrence(node, textnode=None, start=0, end=0, bounded_text=None):
    """Adjacent explicit labels only; block/br boundaries prevent card leakage.

    A shared/conflicting Phone/Fax field is conservatively fax for legacy
    kind != 'fax' consumers, with an additive review flag (not verified fax).
    """
    is_tail = textnode is not None and textnode.is_tail
    container = node.getparent() if is_tail else node
    if container is None:
        return 'phone', False
    link = next((p for p in [container, *container.iterancestors()] if p.tag == 'a'), None)
    target = link if link is not None else node
    root = container
    while root.getparent() is not None and root.tag not in _BLOCKS:
        root = root.getparent()
    # A label cell and value cell belong to one row; rows never share labels.
    parts, offsets, spans = [], {}, {}
    position = 0

    def append(value):
        nonlocal position
        parts.append(value)
        position += len(value)

    def visit(element):
        if not isinstance(element.tag, str):
            return
        if element.tag in {'script', 'style', 'noscript', 'template'} or element.get('hidden') is not None or element.get('aria-hidden') == 'true' or re.search(r'(?:display\s*:\s*none|visibility\s*:\s*hidden)', element.get('style', ''), re.I):
            return
        if element is not root and (element.tag in _BLOCKS or element.tag == 'br'):
            append('\n')
        begin = position
        if element.text:
            offsets[(element, False)] = position
            append(element.text)
        for child in element:
            visit(child)
            if child.tail:
                offsets[(child, True)] = position
                append(child.tail)
        spans[element] = (begin, position)
        if element is not root and element.tag in _BLOCKS:
            append('\n')
        elif element.tag in {'td', 'th'}:
            append(' ')

    visit(root)
    field = ''.join(parts) if bounded_text is None else bounded_text
    if bounded_text is not None:
        begin,finish=start,end
    elif link is not None or textnode is None:
        begin, finish = spans.get(target, (0, 0))
    else:
        offset = offsets.get((node, is_tail))
        if offset is None:
            return 'phone', False
        begin, finish = offset + start, offset + end
    before = field[:begin].rsplit('\n', 1)[-1]
    after = field[finish:].split('\n', 1)[0]
    labels = []
    leading = re.search(_LABEL_RUN + r'$', before, re.I)
    # Only an otherwise empty trailing field can label the preceding number.
    # In "Phone: NUMBER Fax: NUMBER", Fax labels the NEXT number.
    trailing = re.fullmatch(r'[\s(,:\-]*' + _LABEL_RUN, after, re.I)
    for match in (leading, trailing):
        if match:
            labels.extend(re.findall(_LABEL, match.group('labels'), re.I))
    if link is not None:
        labels.extend(re.findall(_LABEL, link.text_content(), re.I))
    # Explicit microdata on this occurrence is also a local label.
    for element in [container, *container.iterancestors()]:
        if element.get('itemprop') in ('telephone', 'faxNumber'):
            labels.append('fax' if element.get('itemprop') == 'faxNumber' else 'phone')
        if element is root:
            break
    fax = any(label.lower() == 'fax' for label in labels)
    ordinary = any(label.lower() != 'fax' for label in labels)
    return ('fax' if fax else 'phone'), fax and ordinary


def normalize_phone(value):
    """Legacy tuple-or-None projection; detailed/raw rejection available separately."""
    candidate = parse_phone_candidate(value)
    if candidate['status'] != 'normalized':
        return None
    return candidate['e164'], candidate['extension']


def extract_published_phones(body,url):
    if not body:return []
    rawbody=body.encode() if isinstance(body,str) else body
    doc=html.fromstring(rawbody,base_url=url);digest=hashlib.sha256(rawbody).hexdigest();records=[];seen=set()
    def add(value,context,method,kind='phone',locator=None,review=False,segments=None,structured_evidence=None):
        if not isinstance(value,(str,int)):return
        normalized=normalize_phone(value)
        if not normalized:return
        number,extension=normalized;context=' '.join(str(context).split())[:500]
        key=(number,extension,kind,method,context,locator,json.dumps(structured_evidence,sort_keys=True))
        if key in seen:return
        seen.add(key)
        records.append({'phone':number,'extension':extension,'raw_value':str(value),'source_url':url,'context':context,
                        'structured_evidence':structured_evidence,'source_segments':segments,'kind':kind,'kind_review_required':review,'extraction_version':VERSION,
                        'normalization_version':PHONE_NORMALIZATION_VERSION,
                        'extraction_method':method,'source_dom_locator':locator,'page_content_sha256':digest,
                        'verification_status':'source_published_unverified','organisation_ownership_status':'not_verified',
                        'branch_ownership_status':'not_verified','outreach_eligibility':'research_only'})
    for script in doc.xpath('//script[contains(@type,"ld+json")]'):
        try:
            for contact in walk_contact_graph(json.loads(script.text or '')):
                if contact['channel'] not in ('telephone','faxNumber'):continue
                add(contact['value'],json.dumps(contact['node'],ensure_ascii=False),'json_ld',
                    'fax' if contact['channel']=='faxNumber' else 'phone',doc.getroottree().getpath(script),structured_evidence=contact)
        except (ValueError,TypeError,RecursionError):pass
    for node in doc.xpath('//*[@itemprop="telephone" or @itemprop="faxNumber"]'):
        if hidden(node):continue
        value=node.get('content') or node.get('href') or node.text_content()
        kind,review=classify_phone_occurrence(node)
        add(value,node.getparent().text_content() if node.getparent() is not None else value,'microdata',kind,doc.getroottree().getpath(node),review)
    for run in iter_contact_text_runs(doc):
        if len(run['segments'])<2:continue
        for pattern in (NANP,LABELLED):
            for match in pattern.finditer(run['text']):
                start=match.start(1) if pattern is LABELLED else match.start()
                if sum(s['start']<match.end() and s['end']>start for s in run['segments'])<2:continue
                kind,review=classify_phone_occurrence(run['node'],start=start,end=match.end(),bounded_text=run['text'])
                add(match.group(1) if pattern is LABELLED else match.group(0),run['text'],'bounded_inline_text',kind,run['source_dom_locator'],review,run['segments'])
    for a in doc.xpath('//a[@href]'):
        if hidden(a):continue
        if not a.get('href','').lower().startswith('tel:'):continue
        parent=a.getparent();context=parent.text_content() if parent is not None else a.text_content()
        kind,review=classify_phone_occurrence(a)
        add(a.get('href'),context,'tel_link',kind,doc.getroottree().getpath(a),review)
    # Scan individual text nodes, not a flattened page where unrelated digits concatenate.
    for textnode in doc.xpath('//text()[normalize-space()]'):
        value=str(textnode);parent=textnode.getparent()
        visible_parent=parent.getparent() if textnode.is_tail else parent
        if visible_parent is None or hidden(visible_parent):continue
        if parent is not None and not isinstance(parent.tag,str):parent=parent.getparent()
        if parent is None:continue
        context=' '.join(parent.text_content().split())[:500]
        for pattern in (NANP,LABELLED):
            for match in pattern.finditer(value):
                raw=match.group(1) if pattern is LABELLED else match.group(0)
                kind,review=classify_phone_occurrence(textnode.getparent(),textnode,match.start(1) if pattern is LABELLED else match.start(),match.end())
                add(raw,context,'visible_text',kind,doc.getroottree().getpath(parent),review)
    return records
