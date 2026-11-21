"""Bounded DNS-only diagnosis of failed source hosts; no HTTP fetch or promotion."""
import concurrent.futures,datetime,json,subprocess,sys
from pathlib import Path
from urllib.parse import urlsplit
ROOT=Path('/data/research/artifacts/regional-contact-enrichment-20261104')
def candidates(receipts,limit=50):
 out=[];seen=set()
 for receipt in receipts:
  if receipt['pages']:continue
  failures=[e for e in receipt.get('errors',[]) if 'DNS lookup failed:' in e.get('error','')]
  if not failures or receipt['host'] in seen:continue
  # Require the failed seed URL itself to name the host whose DNS failed.
  urls=[e['url'] for e in failures if urlsplit(e.get('url','')).hostname and e['error'].endswith('DNS lookup failed: '+urlsplit(e['url']).hostname)]
  if not urls:continue
  hosts=sorted({urlsplit(u).hostname for u in urls})
  base=receipt['host'];allowed={base,'www.'+base}
  if not set(hosts)<=allowed:continue
  out.append({'host':base,'failed_hosts':hosts,'original_urls':urls,'original_checked_at':receipt.get('checked_at'),'source_record_ids':[r['source_record_id'] for r in receipt['records']]});seen.add(base)
  if len(out)>=limit:break
 return out
CODE="""import socket,sys,json,ipaddress
try:
 addresses=sorted({r[4][0] for r in socket.getaddrinfo(sys.argv[1],443,type=socket.SOCK_STREAM)})
 print(json.dumps({'state':'public_dns' if addresses and all(ipaddress.ip_address(a).is_global for a in addresses) else 'non_public_or_empty','address_count':len(addresses)}))
except socket.gaierror as exc:print(json.dumps({'state':'dns_error','error_code':exc.errno}))
"""
def lookup(host):
 try:
  result=subprocess.run([sys.executable,'-c',CODE,host],capture_output=True,text=True,timeout=5)
  return json.loads(result.stdout) if result.returncode==0 else {'state':'resolver_process_error'}
 except subprocess.TimeoutExpired:return {'state':'resolver_timeout'}
def diagnose(row,resolver=lookup):
 results={h:resolver(h) for h in sorted({row['host'],'www.'+row['host']})}
 original_resolves=any(results[h]['state']=='public_dns' for h in row['failed_hosts'])
 alternate_resolves=any(v['state']=='public_dns' for h,v in results.items() if h not in row['failed_hosts'])
 state='original_host_now_resolves' if original_resolves else 'www_variant_resolves_needs_source_review' if alternate_resolves else 'still_unresolved_or_non_public'
 return {**row,'dns':results,'state':state,'website_identity_verified':False,'http_requests':0,'send_ready':False}
def main():
 manifest=ROOT/'dns-diagnostic-scope-20261105.json'
 if manifest.exists():scope=json.loads(manifest.read_text())
 else:
  scope=candidates((json.loads(p.read_text()) for p in sorted((ROOT/'sources').glob('*/receipt.json'))));manifest.write_text(json.dumps(scope,indent=2))
 with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:rows=list(pool.map(diagnose,scope))
 summary={'checked_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'domains_checked':len(rows),'original_host_now_resolves':sum(r['state']=='original_host_now_resolves' for r in rows),'www_variant_resolves':sum(r['state']=='www_variant_resolves_needs_source_review' for r in rows),'still_unresolved_or_non_public':sum(r['state']=='still_unresolved_or_non_public' for r in rows),'http_requests':0,'paid_api_calls':0,'messages_sent':0}
 p=ROOT/'dns-diagnostic-20261105.json';t=p.with_suffix('.tmp');t.write_text(json.dumps({'summary':summary,'rows':rows},indent=2));t.replace(p);print(json.dumps(summary))
if __name__=='__main__':main()
