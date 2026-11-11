"""Extract published email evidence, with page context and no guessed inboxes."""
from __future__ import annotations

import hashlib
import json
import re
from urllib.parse import unquote, urlsplit

from lxml import html
from .structured_contacts import walk_contact_graph
from .contact_text_runs import iter_contact_text_runs
from .contact_normalization import parse_email_candidate, EMAIL_NORMALIZATION_VERSION

VERSION = "ssm-published-email-extraction/6"
# Whole published candidate, including unsupported Unicode/quoted syntax.
# Validation belongs to clean_email(), never an ASCII substring search.
EMAIL = re.compile(r'((?:"[^"\r\n]+"|[^\s<>"(),;:]+)@[^\s<>"(),;:]+)')
ASSET_TLDS = {"png", "jpg", "jpeg", "webp", "gif", "svg", "css", "js", "woff", "woff2", "ico"}
PLACEHOLDER_DOMAINS = {"example.com", "example.org", "example.net"}
INFRASTRUCTURE_DOMAINS = {"sentry.io", "wixpress.com"}
ROLE_PREFIXES = {
    "procurement": {"procurement", "purchasing", "vendors", "suppliers"},
    "facilities": {"facilities", "maintenance", "operations"},
    "sales": {"sales", "quotes", "estimating", "estimates", "partnerships"},
    "general_business": {"info", "hello", "office", "contact", "admin", "reception", "team"},
    "customer_support": {"support", "customerservice", "customer.service", "help"},
    "careers": {"careers", "jobs", "hr", "recruitment"},
    "privacy_legal": {"privacy", "legal", "dpo", "abuse"},
    "automated_or_technical": {"noreply", "no-reply", "donotreply", "webmaster"},
}


def clean_email(value):
    return parse_email_candidate(value)['email']


def role_hint(email):
    local = email.split("@", 1)[0].lower().split("+", 1)[0]
    return next((role for role, prefixes in ROLE_PREFIXES.items() if local in prefixes), "unspecified_published_inbox")


def cfemail_decode(value):
    try:
        blob = bytes.fromhex(value)
        if len(blob) < 2:
            return None
        return bytes(byte ^ blob[0] for byte in blob[1:]).decode("utf-8")
    except (ValueError, UnicodeError):
        return None


def literal_click_email_occurrences(raw):
    """Decode fully literal public email actions; never evaluate JS or infer names."""
    literal = r'''(["'])([^"'\\]*)\1'''
    concat = r'''(["'])(mailto:[^"'\\\r\n]*)\1\s*\.concat\(([^)]{1,250})\)'''
    plus = r'''(["'])(mailto:[^"'\\\r\n]*)\1((?:\s*\+\s*["'][^"'\\\r\n]*["'])+)'''
    found = []
    for pattern, method in ((concat, 'concat'), (plus, 'plus')):
        for hit in re.finditer(pattern, raw):
            before = raw[max(0, hit.start()-350):hit.start()]
            if not any(marker in before for marker in ('onclick', 'addEventListener')):
                continue
            if raw[hit.end():].lstrip().startswith(('+', '.')):
                continue
            args = hit.group(3)
            if method == 'concat' and re.sub(literal, '', args).strip(' ,\t\r\n'):
                continue
            address = hit.group(2)[7:] + ''.join(part[1] for part in re.findall(literal, args))
            if EMAIL.fullmatch(address):
                found.append({"value":address,"start":hit.start(),"end":hit.end()})
    return sorted(found,key=lambda row:(row["start"],row["end"],row["value"]))


def literal_click_emails(raw):
    return sorted({row["value"] for row in literal_click_email_occurrences(raw)})


def extract_email_occurrences(body, page_url, *, candidate_evidence=None):
    raw = body if isinstance(body, bytes) else body.encode()
    if not raw.strip() or raw.lstrip().startswith((b'%PDF', b'PK\x03\x04', b'\x89PNG', b'\xff\xd8', b'\x1f\x8b')) or b'\x00' in raw[:4096]:
        return []
    document = html.fromstring(body, base_url=page_url)
    content_hash = hashlib.sha256(body if isinstance(body, bytes) else body.encode()).hexdigest()
    page_host = (urlsplit(page_url).hostname or "").lower().removeprefix("www.")
    findings = {}

    def hidden(node):
        return any(item.tag in ("template", "noscript") or item.get("hidden") is not None or item.get("aria-hidden") == "true" or
                   re.search(r"display\s*:\s*none|visibility\s*:\s*hidden", item.get("style") or "", re.I)
                   for item in [node, *node.iterancestors()])

    def add(value, method, node=None, text_context="", pointer=None, position=None, owner=None):
        parsed = parse_email_candidate(value)
        if candidate_evidence is not None:
            candidate_evidence.append({**parsed, 'source_url': page_url, 'page_content_sha256': content_hash,
                                       'extraction_method': method, 'extraction_version': VERSION,
                                       'source_dom_locator': document.getroottree().getpath(node) if node is not None else None,
                                       'outreach_eligibility': 'research_only'})
        email = parsed['email']
        if not email:
            return
        mailbox_host = email.rsplit("@", 1)[1]
        if any(mailbox_host == domain or mailbox_host.endswith("." + domain) for domain in INFRASTRUCTURE_DOMAINS) and not (page_host == mailbox_host or page_host.endswith("." + mailbox_host)):
            return
        context_node = node
        if context_node is not None:
            context_node = next((n for n in [node,*node.iterancestors()] if n.tag in ("p","li","td","th","div","section","article","footer","address")),node)
        local_text=[]
        if context_node is not None:
            for textnode in context_node.xpath('.//text()'):
                parent=textnode.getparent().getparent() if textnode.is_tail else textnode.getparent()
                if parent is not None and not hidden(parent) and not any(n.tag in ('script','style','noscript','template') for n in [parent,*parent.iterancestors()]):local_text.append(str(textnode))
        context = text_context or " ".join(" ".join(local_text).split())
        if len(context)>500:context=context[:500]
        relation = "published_on_page; organisation_and_person_ownership_unverified"
        if re.search(r"website (?:by|design)|designed by|powered by|web design", context, re.I):
            relation = "possible_website_vendor_contact_requires_review"
        locator = document.getroottree().getpath(node) if node is not None else None
        occurrence = {
            "email": email, "raw_value": str(value), "normalization_version": EMAIL_NORMALIZATION_VERSION,
            "source_url": page_url, "page_content_sha256": content_hash,
            "extraction_method": method, "source_dom_locator": locator, "json_pointer": pointer,
            "text_position": position, "candidate_owner": {
                "source_dom_locator": document.getroottree().getpath(context_node) if context_node is not None else None,
                "status": "unresolved"},
            "visibility_basis": "structured_assertion" if 'json' in method else
                ("published_action" if 'javascript' in method else "visible_dom"),
            "role_hint": role_hint(email), "association_status": relation,
            "short_supporting_context": context[:350], "mailbox_status": "not_checked",
            "ownership_status": "not_checked", "outreach_eligibility": "research_only", "extraction_version": VERSION}
        if owner is not None:
            occurrence['candidate_owner']=owner
        occurrence['occurrence_id'] = hashlib.sha256(json.dumps(occurrence,sort_keys=True).encode()).hexdigest()
        findings[occurrence['occurrence_id']] = occurrence

    # Definitions and references are local to one JSON-LD script; no remote resolution.
    def embedded(value, depth=0, node=None, pointer=""):
        if depth > 30:return
        if isinstance(value, list):
            for index,item in enumerate(value):embedded(item, depth+1, node, pointer+"/"+str(index))
        elif isinstance(value, dict):
            for key, item in value.items():
                if key.casefold() in ('email', 'emailaddress', 'email_address', 'workemail', 'work_email'):
                    for index,address in enumerate(item if isinstance(item, list) else [item]):
                        if isinstance(address, str):
                            add(address.removeprefix('mailto:'), 'embedded_json_email_field_requires_display_review',
                                node=node, pointer=pointer+'/'+key.replace('~','~0').replace('/','~1')+(('/'+str(index)) if isinstance(item,list) else ''), text_context='Literal email field in page-delivered JSON; visible display and owner unverified')
                elif isinstance(item, (dict, list)):
                    embedded(item, depth+1, node, pointer+"/"+key.replace("~","~0").replace("/","~1"))

    for script in document.xpath('//script[@type="application/ld+json"]'):
        try:
            for contact in walk_contact_graph(json.loads(script.text or "")):
                if contact['channel']!='email':continue
                method='public_person_jsonld' if 'Person' in contact['node']['types'] else 'public_organisation_jsonld'
                add(contact['value'].removeprefix('mailto:'),method,node=script,pointer=contact['json_pointer'],
                    owner={k:contact[k] for k in ('candidate_owners','ownership_status','candidate_employers','node_pointer','ambiguity_review_required')},
                    text_context='Public structured contact field; ownership unverified')
        except (ValueError, TypeError, RecursionError):
            pass
    for script in document.xpath('//script[@type="application/json"]'):
        try:embedded(json.loads(script.text or ''), node=script)
        except (ValueError, TypeError, RecursionError):pass
    for script in document.xpath('//script[not(@src)]'):
        for hit in literal_click_email_occurrences(script.text or ''):
            add(hit['value'], 'literal_javascript_email_action', node=script, position={'field':'text','start':hit['start'],'end':hit['end']}, text_context='Explicit literal mailto action published in page script; owner unverified')
    for node in document.xpath('//*[@onclick or @data-email or @data-email-address or @itemprop="email"]'):
        if hidden(node):continue
        if node.get('onclick'):
            for hit in literal_click_email_occurrences('onclick='+node.get('onclick')):
                add(hit['value'], 'literal_javascript_email_action', node, position={'attribute':'onclick','start':hit['start']-8,'end':hit['end']-8})
        for attr in ('data-email', 'data-email-address'):
            if node.get(attr):add(unquote(node.get(attr)), 'explicit_email_html_attribute', node, position={'attribute':attr})
        if node.get('itemprop') == 'email':
            value=node.get('content',node.get('href',''))
            if value:add(unquote(value.removeprefix('mailto:')), 'schema_email_html_attribute', node, position={'attribute':'content' if node.get('content') is not None else 'href'})
    for node in document.xpath('//*[@data-cfemail]'):
        if hidden(node):
            continue
        decoded = cfemail_decode(node.get("data-cfemail", ""))
        if decoded:
            add(decoded, "public_cfemail_presentation", node)
    for anchor in document.xpath("//a[@href]"):
        if hidden(anchor):
            continue
        href = anchor.get("href", "").strip()
        if not href.lower().startswith("mailto:"):
            continue
        recipients = unquote(href[7:].split("?", 1)[0])
        if any(character in recipients for character in "\r\n\x00"):
            continue
        for index,recipient in enumerate(re.split(r"[,;]", recipients)):
            add(recipient, "mailto_recipient", anchor, position={"attribute":"href","recipient_index":index})
    inline_runs=list(iter_contact_text_runs(document))
    split_fragments={}
    for run in inline_runs:
        for match in EMAIL.finditer(run['text']):
            touched=[s for s in run['segments'] if s['start']<match.end() and s['end']>match.start()]
            if len(touched)>1:
                for segment in touched:
                    split_fragments.setdefault((segment['source_dom_locator'],segment['field']),[]).append(
                        (max(0,match.start()-segment['start']),min(segment['end'],match.end())-segment['start']))
    for node in document.iter():
        # Read visible text nodes once; tail text belongs to the parent context.
        for text, context in ((node.text if isinstance(node.tag, str) else None, node), (node.tail, node.getparent())):
            if not text:
                continue
            if context is None or hidden(context) or any(n.tag in ("script","style","noscript","template") for n in [context,*context.iterancestors()]):
                continue
            for match in EMAIL.finditer(text):
                slot=(document.getroottree().getpath(node),'text' if context is node else 'tail')
                if any(start<match.end() and end>match.start() for start,end in split_fragments.get(slot,[])):continue
                add(match.group(0), "visible_text", context, position={"node":document.getroottree().getpath(node),"field":"text" if context is node else "tail","start":match.start(),"end":match.end()})
            explicit = re.sub(r"\s*(?:\[at\]|\(at\))\s*", "@", text, flags=re.I)
            explicit = re.sub(r"\s*(?:\[dot\]|\(dot\))\s*", ".", explicit, flags=re.I)
            if explicit != text:
                for match in EMAIL.finditer(explicit):
                    add(match.group(0), "explicit_visible_at_dot", context, position={"start":match.start(),"end":match.end(),"offset_basis":"decoded_text","node":document.getroottree().getpath(node),"field":"text" if context is node else "tail", "raw_text":text})
    for run in inline_runs:
        if len(run['segments'])<2:continue
        text=run['text']
        explicit=re.sub(r"\s*(?:\[at\]|\(at\))\s*", "@", text, flags=re.I)
        explicit=re.sub(r"\s*(?:\[dot\]|\(dot\))\s*", ".", explicit, flags=re.I)
        for candidate,method in ((text,'bounded_inline_text'),(explicit,'bounded_inline_at_dot')):
            if method.endswith('at_dot') and explicit==text:continue
            for match in EMAIL.finditer(candidate):
                if candidate==text and sum(s['start']<match.end() and s['end']>match.start() for s in run['segments'])<2:continue
                add(match.group(0),method,run['node'],position={'segments':run['segments'],'raw_text':text,'start':match.start(),'end':match.end(),'offset_basis':'decoded_run' if candidate!=text else 'literal_run'})
    return [findings[key] for key in sorted(findings)]


def summarize_email_occurrences(occurrences):
    grouped = {}
    for occurrence in occurrences:
        grouped.setdefault(occurrence["email"], {})[occurrence["occurrence_id"]] = occurrence
    result = []
    for email, rows in sorted(grouped.items()):
        rows = sorted(rows.values(), key=lambda row: row["occurrence_id"])
        summary = dict(rows[0])
        summary.pop("occurrence_id", None)
        summary["occurrences"] = rows
        summary["extraction_methods"] = sorted({row["extraction_method"] for row in rows})
        relations = {row["association_status"] for row in rows}
        if "possible_website_vendor_contact_requires_review" in relations:
            summary["association_status"] = "possible_website_vendor_contact_requires_review"
        summary["review_warnings"] = ["conflicting_occurrence_contexts"] if len(relations)>1 else []
        owners={json.dumps(row['candidate_owner'],sort_keys=True) for row in rows}
        if len(owners)>1 or any(row['candidate_owner'].get('ambiguity_review_required') for row in rows):
            summary['review_warnings'].append('multiple_or_ambiguous_occurrence_owners_require_review')
        result.append(summary)
    return result


def extract_published_emails(body, page_url, *, candidate_evidence=None):
    return summarize_email_occurrences(extract_email_occurrences(body,page_url,candidate_evidence=candidate_evidence))


def extract_email_evidence(body, page_url):
    """Opt-in diagnostic envelope; legacy callers still receive valid summaries."""
    candidates = []
    emails = extract_published_emails(body, page_url, candidate_evidence=candidates)
    return {'emails': emails, 'unsupported_candidates': [r for r in candidates if r['status'] == 'unsupported'],
            'invalid_candidates': [r for r in candidates if r['status'] == 'invalid']}
