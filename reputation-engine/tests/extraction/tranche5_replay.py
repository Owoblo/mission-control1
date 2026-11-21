"""Offline deterministic frontier and byte-transfer replay; never opens network sockets."""
import argparse,importlib.util,json,sys,tempfile
from pathlib import Path
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[2]

def main():
 p=argparse.ArgumentParser();p.add_argument('--implementation-root',default=str(ROOT));p.add_argument('--output',required=True);a=p.parse_args()
 out=Path(a.output).resolve()
 if out.exists() or not out.is_relative_to(Path(tempfile.gettempdir()).resolve()):p.error('new temporary output directory required')
 sys.path.insert(0,str(Path(a.implementation_root).resolve()))
 from scripts.market_map.offline_guard import OfflineGuard
 guard=OfflineGuard(out);guard.install();out.mkdir()
 from scripts.market_map import email_acquisition,phone_acquisition,contact_enrichment
 from scripts.market_map.transport import Response
 graph={'/':b'<a href="/about">About</a><a href="/contact-lenses">Shop</a><a href="/contact">Contact</a><a href="/equipe">Equipe</a>', '/about':b'<p>Our history</p>', '/contact-lenses':b'<p>Shop</p>', '/contact':b'<p>Email desk@business.test Phone (519) 555-0123</p>', '/equipe':b'<p>Our team</p>'}
 from urllib.parse import urlsplit
 rows={}
 for module in [email_acquisition,phone_acquisition,contact_enrichment]:
  trace=[]
  with patch.object(module,'Transport') as factory:
   client=factory.return_value;client.metrics.return_value={}
   def fetch(url,**kw):
    body=graph[urlsplit(url).path];trace.append({'url':url,'body_bytes':len(body),'labeled_contact_page':urlsplit(url).path=='/contact'});return Response(body,{},url)
   client.fetch.side_effect=fetch
   args=[{'domain':'business.test','url':'https://business.test/'},[{'url':'https://business.test/','depth':0}]]
   if module==email_acquisition:args.append([])
   result=module.collect_domain(*args,page_limit=2)
   rows[module.__name__]={'requests':trace,'output':result,'contact_page_reached':any(r['labeled_contact_page'] for r in trace)}
 # Frozen labeled corpus separates extraction/attribution quality from scheduling.
 from scripts.market_map.extraction_benchmark import benchmark
 corpus=ROOT/'tests/extraction/tranche3_fixtures'
 accuracy=benchmark(corpus/'manifest.json',corpus/'labels.jsonl')
 report={'frontier':rows,'accuracy':accuracy}
 # Resource replay uses actual guarded Transport with injected HTTP responses.
 spec=importlib.util.spec_from_file_location('fixture_server',ROOT/'tests/market_map/test_contact_capture.py');fixture=importlib.util.module_from_spec(spec)
 try:
  spec.loader.exec_module(fixture)
 except ModuleNotFoundError:
  fixture=None # pre-PR16 tree intentionally has no adapter
 if fixture:
  from scripts.market_map.contact_capture import get_or_fetch_capture
  measured={}
  for shared in [False,True]:
   server=fixture.Server();metrics=[];receipts=[]
   with patch('socket.getaddrinfo',return_value=fixture.PUBLIC):
    for _ in range(3):
     t=server.transport();response,receipt=get_or_fetch_capture('https://business.test/contact',t,allowed_hosts={'business.test'},root=out/'cache' if shared else None,policy_check=fixture.policy)
     metrics.append(t.metrics());receipts.append(receipt)
   measured['shared' if shared else 'independent']={'trace':server.trace,'metrics':metrics,'full_body_responses':server.full_bodies(),'http_requests':len(server.trace),'network_body_bytes':sum(m['bytes_fetched'] for m in metrics),'reused_bytes':sum(m['capture_reused_bytes'] for m in metrics),'distinct_capture_receipts':len({r['capture_id'] for r in receipts})}
  report['resource_replay']=measured
 (out/'run.json').write_text(json.dumps(report,indent=2,sort_keys=True,default=str)+'\n')
 if guard.violations:raise RuntimeError(guard.violations)
 print(json.dumps({'frontier':{k:v['contact_page_reached'] for k,v in rows.items()},'accuracy':{k:accuracy[k] for k in ['capture_count','extraction','attribution']},'resources':report.get('resource_replay')}))
if __name__=='__main__':main()
