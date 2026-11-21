"""Offline cached-source URL discovery. Never current-occupancy verification.

Parse each eligible capture once; candidate URLs must still pass current guarded
capture/cache freshness checks. Local cached text is never an admission receipt.
"""
from collections import Counter
import hashlib
import ipaddress
import json
from pathlib import Path
import re
import unicodedata
from urllib.parse import urlsplit

from .site_source_extract import extract_source, MAX_BYTES


ALIASES = {'st':'street','rd':'road','ave':'avenue','av':'avenue','blvd':'boulevard',
           'dr':'drive','ct':'court','cres':'crescent','pl':'place','hwy':'highway',
           'east':'e','west':'w','north':'n','south':'s'}


def normalized(value, address=False):
    tokens=re.findall(r'\w+|[#/-]',unicodedata.normalize('NFKC',value).casefold())
    return ' '.join(ALIASES.get(t,t) if address else t for t in tokens)


def safe_url(value):
    if not isinstance(value,str):return False
    try:
        p=urlsplit(value)
        if (p.scheme!='https' or not p.hostname or p.username or p.password or
                p.port not in (None,443) or p.fragment or p.path.rstrip('/').endswith('/robots.txt')):
            return False
        host=p.hostname.lower()
        if host=='localhost' or host.endswith(('.localhost','.local','.internal')):return False
        try:
            return ipaddress.ip_address(host).is_global
        except ValueError:
            return '.' in host
    except ValueError:
        return False


def bounded_match(text, needle):
    """Exact token sequence; prevent street-range/unit/direction prefix matches."""
    if not needle:return []
    result=[]
    for m in re.finditer(r'(?<!\w)'+re.escape(needle)+r'(?!\w)',text):
        before=text[:m.start()].rstrip().split(' ')[-1:]
        after=text[m.end():].lstrip().split(' ')[:1]
        if before and (before[0].isdigit() or before[0] in ('-','/','#')):continue
        if after and after[0] in ('-','/','#','unit','suite','apt','apartment','floor','e','w','n','s'):
            continue
        result.append(m.start())
    return result


class SiteSourceIndex:
    def __init__(self, root, cache_dir=None):
        self.root=Path(root).resolve()
        self.cache=Path(cache_dir or self.root/'.runtime/trusted-source-cache/objects').resolve()
        if self.root not in self.cache.parents:
            raise ValueError('Cache must be inside repository')
        self.records=[]
        self.stats=Counter()
        seen=set()
        for path in sorted(self.cache.glob('*.receipt.json')):
            self.stats['receipts_seen']+=1
            try:
                if path.resolve().parent != self.cache:raise ValueError('receipt_path_escape')
                if path.stat().st_size>64*1024:raise ValueError('oversized_receipt')
                raw=path.read_bytes()
                if path.name!=hashlib.sha256(raw).hexdigest()+'.receipt.json':
                    raise ValueError('receipt_hash_mismatch')
                receipt=json.loads(raw)
                url=receipt.get('requested_url')
                if not safe_url(url) or not safe_url(receipt.get('final_url',url)):
                    self.stats['excluded_non_source_url']+=1;continue
                if receipt.get('status')!=200 or not receipt.get('retrieved_at'):
                    raise ValueError('missing_capture_provenance')
                mime=(receipt.get('content_type') or '').split(';')[0].strip().lower()
                if mime not in ('text/html','application/xhtml+xml','text/plain','application/json','application/ld+json'):
                    self.stats['excluded_non_text_seed']+=1;continue
                if any(flag in receipt.get('cache_control','').lower() for flag in ('private','no-store')):
                    raise ValueError('shared_storage_prohibited')
                body_path=(self.root/receipt['body_path']).resolve()
                if body_path.parent!=self.cache:raise ValueError('body_path_escape')
                if body_path.stat().st_size>MAX_BYTES:raise ValueError('oversized_body')
                body=body_path.read_bytes()
                digest=hashlib.sha256(body).hexdigest()
                if digest!=receipt.get('body_sha256') or body_path.name!=digest+'.body':
                    raise ValueError('body_hash_mismatch')
                key=(url,digest)
                if key in seen:continue
                seen.add(key)
                extracted=extract_source(body,source_url=url,retrieved_at=receipt['retrieved_at'],
                    target_addresses=[],target_locality='__INDEX_ONLY__',
                    content_type=receipt.get('content_type') or 'text/plain',expected_sha256=digest)
                structured=[]
                for candidate in extracted['candidates']:
                    address=candidate.get('address_assertion')
                    if not isinstance(address,dict) or candidate.get('explicit_unit_fields'):continue
                    street,city=address.get('streetAddress'),address.get('addressLocality')
                    if isinstance(street,str) and isinstance(city,str) and street.strip() and city.strip():
                        structured.append((normalized(street,True),normalized(city)))
                self.records.append(dict(url=url,structured=structured,
                    text=normalized(extracted['text'],True),
                    retrieved_at=receipt['retrieved_at']))
                self.stats['sources_indexed']+=1
            except (ValueError,KeyError,OSError,TypeError) as exc:
                self.stats['excluded_invalid_capture']+=1
                self.stats['reason:'+str(exc)[:80]]+=1

    def lookup(self, site, limit=4):
        if not 1<=limit<=4:raise ValueError('Source seed limit is 1..4')
        addresses=site.get('addresses',site.get('candidate_addresses',[]))
        if isinstance(addresses,str):addresses=json.loads(addresses)
        city=site.get('municipality','')
        if not isinstance(addresses,list) or not isinstance(city,str) or not city.strip():
            raise ValueError('Explicit addresses and municipality required')
        targets={normalized(a,True) for a in addresses if isinstance(a,str) and a.strip()}
        names=list(site.get('reported_place_names',[]))
        for member in site.get('members',[]):
            if isinstance(member,dict):names.extend(member.get('reported_place_names',[]))
        names={normalized(n,True) for n in names if isinstance(n,str) and len(n.strip())>=3}
        matches=[]
        for record in self.records:
            if any(street in targets and locality==normalized(city) for street,locality in record['structured']):
                matches.append((0,record['url']));continue
            if not names or not any(target in record['text'] for target in targets):continue
            if not names or not re.search(r'(?<!\w)'+re.escape(normalized(city,True))+r'(?!\w)',record['text']):continue
            positions=[p for target in targets for p in bounded_match(record['text'],target)]
            if not positions:continue
            name_positions=[m.start() for name in names for m in re.finditer(r'(?<!\w)'+re.escape(name)+r'(?!\w)',record['text'])]
            if any(abs(a-n)<=600 for a in positions for n in name_positions):
                matches.append((1,record['url']))
        return list(dict.fromkeys(url for _,url in sorted(matches)))[:limit]
