"""Offline route-attribution comparison using identical hash-checked synthetic pages."""
import argparse,hashlib,inspect,json,sys,tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
def main():
 p=argparse.ArgumentParser();p.add_argument('--implementation-root',default=str(ROOT));p.add_argument('--output',required=True);a=p.parse_args()
 implementation=Path(a.implementation_root).resolve();output=Path(a.output).resolve()
 if output.exists() or not output.is_relative_to(Path(tempfile.gettempdir()).resolve()):p.error('new system temporary output directory required')
 sys.path[:0]=[str(implementation),str(implementation/'scripts/discovery_v2')]
 from scripts.market_map.offline_guard import OfflineGuard
 guard=OfflineGuard(output);guard.install();output.mkdir()
 from contacts import extract
 from scripts.market_map.extraction_benchmark import counts
 from lxml import html
 base=ROOT/'tests/extraction/tranche4_fixtures';manifest=json.loads((base/'manifest.json').read_text());results=[];actual=set();expected=set()
 for row in manifest:
  body=(base/row['file']).read_bytes()
  if hashlib.sha256(body).hexdigest()!=row['sha256']:raise ValueError('capture hash mismatch')
  url='https://business.test/team';email=row['named'][0]['to']
  # Legacy flattened payload is identical for both implementations, including explicit script values.
  text='Office Windsor '+' '.join(html.fromstring(body).itertext())
  review={'id':row['id'],'name':'Office','city':'Windsor','pages':[{'url':url,'text':text,'emails':[email]}]}
  kwargs={'evidence':{url:{'body':body,'sha256':row['sha256']}} if row['use_capture'] else None} if 'evidence' in inspect.signature(extract).parameters else {}
  routes,holds=extract([review],row['named'],**kwargs)
  supported=any(r['role_supported'] for r in routes)
  if supported:actual.add(row['id'])
  if row['expected_supported']:expected.add(row['id'])
  results.append({'id':row['id'],'capture_sha256':row['sha256'],'expected_supported':row['expected_supported'],'actual_supported':supported,'routes':routes,'holds':holds})
 from scripts.market_map.cloud.regional_email_inventory import inventory,pilot_candidates
 from scripts.market_map.email_extraction import extract_published_emails
 regional=[];corpus=ROOT/'tests/extraction/tranche3_fixtures'
 captures={r['id']:r for r in json.loads((corpus/'manifest.json').read_text())['pages']}
 for case in ['reference','shared-reference','repeated-context','person-employer']:
  capture=captures[case];body=(corpus/capture['file']).read_bytes()
  if hashlib.sha256(body).hexdigest()!=capture['sha256']:raise ValueError('regional capture hash mismatch')
  records=[{'source_record_id':'local-office','organization':'Office','municipality':'Windsor'}]
  rows=inventory([{'records':records,'pages':[{'url':capture['url'],'emails':extract_published_emails(body,capture['url'])}]}])
  regional.append({'id':case,'capture_sha256':capture['sha256'],'rows':rows,'pilot_candidates':[r['email'] for r in pilot_candidates(rows)]})
 result={'regional':regional,'scope':'synthetic scoped named-route support; not verified employment','metrics':counts(actual,expected),'results':results,
         'errors':[r for r in results if r['expected_supported']!=r['actual_supported']],
         'implementation_sha256':{str(f.relative_to(implementation)):hashlib.sha256(f.read_bytes()).hexdigest() for f in [implementation/'scripts/discovery_v2/contacts.py',implementation/'scripts/market_map/contact_context.py']}}
 (output/'run.json').write_text(json.dumps(result,indent=2,ensure_ascii=False)+'\n')
 if guard.violations:raise RuntimeError(guard.violations)
 print(json.dumps(result['metrics']))
if __name__=='__main__':main()
