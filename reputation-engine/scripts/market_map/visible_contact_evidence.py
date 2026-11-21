"""Find compact visible contact blocks for review, never grant verification."""
import hashlib,re
from lxml import html
from scripts.market_map.contact_text_runs import iter_contact_text_runs
from scripts.market_map.phone_extraction import NANP,normalize_phone

def words(value):
 aliases={'street':'st','road':'rd','avenue':'ave','drive':'dr','boulevard':'blvd','east':'e','west':'w','north':'n','south':'s'}
 return ' '.join(aliases.get(w,w) for w in re.findall(r'[a-z0-9]+',str(value or '').lower()))
def contains(text,value):return bool(value) and (' '+value+' ') in (' '+text+' ')

def blocks(body,record,expected_hash):
 number='+1'+str(record.get('phone_base',''))
 return blocks_for_numbers(body,record,{number},expected_hash).get(number,[])

def blocks_for_numbers(body,record,numbers,expected_hash):
 """Parse once for several observed numbers; do not alter mapped phone identity."""
 if hashlib.sha256(body).hexdigest()!=expected_hash:return {}
 name=words(record.get('organization'));address=words(record.get('address'))
 cities={words(record.get(k)) for k in ['municipality','source_city_label']}-{''}
 if len(name)<5 or not address or not re.search(r'\d',address):return {}
 doc=html.fromstring(body)
 literal_runs=list(iter_contact_text_runs(doc))
 original_paths={n:doc.getroottree().getpath(n) for n in doc.iter()}
 for node in doc.xpath('//script|//style|//noscript|//template|//head|//*[@hidden or @aria-hidden="true"]'):
  if node.getparent() is not None:node.drop_tree()
 for node in doc.xpath('//*[@style]'):
  if re.search(r'display\s*:\s*none|visibility\s*:\s*hidden',node.get('style',''),re.I) and node.getparent() is not None:node.drop_tree()
 found={}
 for node in doc.iter():
  if not isinstance(node.tag,str) or node.tag in {'html','body'}:continue
  excerpt=' '.join(node.text_content().split())
  if not 20<=len(excerpt)<=1200:continue
  text=words(excerpt)
  # A brand-like email prefix or URL is not an independently stated business name.
  identity_text=words(re.sub(r'https?://\S+|\b[^\s@]+@[^\s@]+\b|\b[a-z0-9][a-z0-9.-]*\.[a-z]{2,}(?:/\S*)?',' ',excerpt,flags=re.I))
  if not contains(identity_text,name) or not contains(text,address) or not any(contains(text,c) for c in cities):continue
  phones=set()
  for value in [str(v) for v in node.xpath('.//text()')]+[run['text'] for run in literal_runs if run['node'] is node or node in run['node'].iterancestors()]:
   for m in NANP.finditer(str(value)):
    p=normalize_phone(m.group(0))
    if p:phones.add(p)
  for link in node.xpath('.//a[starts-with(@href,"tel:")]'):
   p=normalize_phone(link.get('href'))
   if p:phones.add(p)
  # Multiple phones/extensions or a fax label need a reviewer with broader context.
  # Extension labels and digits may live in separate DOM nodes from the phone.
  # Join with spaces only for this conservative hold, never to discover numbers.
  visible_parts=' '.join(str(value).strip() for value in node.xpath('.//text()'))
  extension_label=re.search(r'(?:\bext(?:ension)?\.?\s*[:=]?\s*|\bx\s*|#\s*)\d{1,10}\b',visible_parts,re.I)
  if len(phones)!=1 or extension_label or re.search(r'\bfax\b',excerpt,re.I):continue
  number,extension=next(iter(phones))
  if extension or number not in numbers:continue
  found.setdefault(number,[]).append({'excerpt':excerpt,'source_dom_locator':original_paths[node],'page_content_sha256':expected_hash,
   'method':'compact_visible_contact_block','review_required':True,'send_ready':False})
 # Prefer the smallest supported block, not an entire page or repeated ancestors.
 return {number:sorted(rows,key=lambda r:len(r['excerpt']))[:1] for number,rows in found.items()}
