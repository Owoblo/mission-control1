import concurrent.futures,hashlib,json,socket,tempfile,unittest,urllib.error
from pathlib import Path
from unittest.mock import patch
from scripts.market_map.contact_capture import get_or_fetch_capture
from scripts.market_map.transport import Transport,SourceBlocked,BudgetExceeded
from scripts.market_map.contact_page import parse_contact_page
from scripts.market_map import email_acquisition,phone_acquisition,contact_enrichment

PUBLIC=[(socket.AF_INET,socket.SOCK_STREAM,6,'',('8.8.8.8',443))]
BODY=b'<p>desk@business.test Phone: (519) 555-0123</p>'
ROBOTS=b'User-agent: *\nAllow: /\n'

def policy(url):return {'allowed':True,'allowed_hosts':['business.test'],'rights_status':'public_capture_reuse_approved','policy_id':'fixture','revision':'1','session_scope':'stateless','representation':'static-html','retention_allowed':True,'reuse_allowed':True,'retain_until':'2099-01-01T00:00:00+00:00','retention_approval_id':'synthetic-fixture-only','delete_expired':True,'valid_until':'2099-01-01T00:00:00+00:00','ttl_seconds':3600}
class HTTP:
 def __init__(self,body,headers=None):self.body=body;self.headers=headers or {};self.status=200
 def __enter__(self):return self
 def __exit__(self,*args):pass
 def read(self,limit):return self.body[:limit]
class Server:
 def __init__(self):self.trace=[];self.control='public, max-age=3600';self.deny=False;self.robots=ROBOTS;self.redirect=False;self.cookie=False
 def open(self,request,timeout=None):
  url=request.full_url;conditional=bool(request.get_header('If-none-match'));self.trace.append({'url':url,'conditional':conditional})
  if url.endswith('/robots.txt'):return HTTP(self.robots)
  if self.deny:raise urllib.error.HTTPError(url,403,'denied',{},None)
  if self.redirect and url.endswith('/old'):raise urllib.error.HTTPError(url,302,'redirect',{'Location':'/contact'},None)
  headers={'ETag':'"v1"','Content-Type':'text/html','Cache-Control':self.control}
  if self.cookie:headers['Set-Cookie']='fixture=private'
  if conditional:raise urllib.error.HTTPError(url,304,'unchanged',headers,None)
  return HTTP(BODY,headers)
 def transport(self,**kw):
  client=Transport(min_interval=0,retries=0,allowed_hosts={'business.test'},**kw);client.opener.open=self.open;return client
 def full_bodies(self):return sum(not r['url'].endswith('/robots.txt') and not r['conditional'] and not (self.redirect and r['url'].endswith('/old')) for r in self.trace)

class CaptureTests(unittest.TestCase):
 def setUp(self):self.dns=patch('socket.getaddrinfo',return_value=PUBLIC);self.dns.start();self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name)/'cache';self.server=Server()
 def tearDown(self):self.temp.cleanup();self.dns.stop()
 def get(self,**kw):return get_or_fetch_capture(kw.pop('url','https://business.test/contact'),kw.pop('transport',self.server.transport()),allowed_hosts={'business.test'},root=self.root,policy_check=kw.pop('policy_check',policy),**kw)
 def test_three_concurrent_consumers_one_body_and_unchanged_capture_time(self):
  def worker(i):
   t=self.server.transport();response,receipt=self.get(transport=t);return response,receipt,t.metrics()
  with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:rows=list(pool.map(worker,range(3)))
  self.assertEqual(self.server.full_bodies(),1);self.assertEqual(len(self.server.trace),6)
  self.assertEqual(len({r[1]['capture_id'] for r in rows}),1);self.assertEqual(len({r[1]['captured_at'] for r in rows}),1)
  self.assertEqual(sum(r[2]['capture_reused_bytes'] for r in rows),2*len(BODY));self.assertEqual(sum(r[2]['bytes_fetched'] for r in rows),len(BODY)+3*len(ROBOTS))
  self.assertTrue(all(parse_contact_page(r[0].body,r[1])['emails'] for r in rows))
 def test_three_generic_extractors_share_source_receipt(self):
  clients=[]
  for module in [email_acquisition,phone_acquisition,contact_enrichment]:
   client=self.server.transport();clients.append(client)
   with patch.object(module,'Transport',return_value=client):
    args=[{'domain':'business.test'},[{'url':'https://business.test/contact','depth':0}]]
    if module==email_acquisition:args.append([])
    result=module.collect_domain(*args,page_limit=1,capture_root=self.root,capture_policy=policy)
    self.assertEqual(len(result['pages']),1)
  self.assertEqual(self.server.full_bodies(),1);self.assertEqual(sum(t.capture_cache_hits for t in clients),2)
 def test_current_http_and_robots_denials_never_use_body(self):
  self.get();self.server.deny=True
  with self.assertRaises(SourceBlocked):self.get()
  self.server.deny=False;self.server.robots=b'User-agent: *\nDisallow: /\n'
  before=len(self.server.trace)
  with self.assertRaises(SourceBlocked):self.get()
  self.assertEqual(len(self.server.trace)-before,1)
 def test_revoked_expired_policy_and_sessions_block_before_requests(self):
  self.get();before=len(self.server.trace)
  for update in [{'allowed':False},{'valid_until':'2000-01-01T00:00:00+00:00'},{'session_scope':'cookie-session'},{'holds':['manual_hold']}]:
   with self.assertRaises(SourceBlocked):self.get(policy_check=lambda url:{**policy(url),**update})
  self.assertEqual(len(self.server.trace),before)
  with self.assertRaises(SourceBlocked):self.get(transport=self.server.transport(anonymous_directory_session=True))
 def test_ttl_scope_integrity_and_no_store(self):
  self.get(clock=lambda:1000);self.get(clock=lambda:5000);self.assertEqual(self.server.full_bodies(),2)
  self.get(policy_check=lambda url:{**policy(url),'revision':'2'},clock=lambda:5001);self.assertEqual(self.server.full_bodies(),3)
  next((self.root/'objects').glob('*.body')).write_bytes(b'corrupt')
  self.get(clock=lambda:5002);self.assertEqual(self.server.full_bodies(),4)
  self.server.control='no-store'
  with self.assertRaises(SourceBlocked):self.get(clock=lambda:5003)
  response,receipt=self.get(clock=lambda:5004);self.assertFalse(receipt['retain_body'])
 def test_private_cookie_maxage_zero_and_retention_denied_do_not_share(self):
  for i,control in enumerate(['private','no-store','max-age=0']):
   self.server.control=control
   options=lambda url:{**policy(url),'revision':str(i+10)}
   self.get(policy_check=options);self.get(policy_check=options)
  self.assertEqual(self.server.full_bodies(),6)
  self.server.control='public';self.server.cookie=True
  self.get();self.get();self.assertEqual(self.server.full_bodies(),8)
  self.server.cookie=False
  for _ in range(2):self.get(policy_check=lambda url:{**policy(url),'retention_allowed':False})
  self.assertEqual(self.server.full_bodies(),10)
 def test_redirect_identity_and_budgets_are_not_bypassed(self):
  self.server.redirect=True
  first=self.get(url='https://business.test/old');second=self.get(url='https://business.test/old')
  self.assertEqual(first[1]['url'],'https://business.test/contact');self.assertTrue(second[0].from_cache)
  with self.assertRaises(BudgetExceeded):self.get(url='https://business.test/old',transport=self.server.transport(max_requests=1))
  with self.assertRaises(BudgetExceeded):self.get(url='https://business.test/old',transport=self.server.transport(max_response_bytes=10))
 def test_policy_denied_redirect_is_not_requested(self):
  self.server.redirect=True
  with self.assertRaises(SourceBlocked):self.get(url='https://business.test/old',policy_check=lambda url:{**policy(url),'allowed':not url.endswith('/contact')})
  self.assertFalse(any(r['url'].endswith('/contact') for r in self.server.trace))

 def test_policy_change_during_response_blocks_release_and_recovers(self):
  self.get();revoked=[False];original=self.server.open
  def changed(request,timeout=None):
   try:return original(request,timeout)
   finally:
    if not request.full_url.endswith('/robots.txt'):revoked[0]=True
  client=self.server.transport();client.opener.open=changed
  with self.assertRaises(SourceBlocked):self.get(transport=client,policy_check=lambda url:{**policy(url),'allowed':not revoked[0]})
  response,receipt=self.get();self.assertTrue(response.from_cache)
 def test_duplicate_content_after_expiry_is_new_fetch_receipt(self):
  _,first=self.get(clock=lambda:1000);_,second=self.get(clock=lambda:5000)
  self.assertEqual(first['sha256'],second['sha256']);self.assertNotEqual(first['capture_id'],second['capture_id']);self.assertNotEqual(first['captured_at'],second['captured_at'])
 def test_reuse_disabled_respects_no_store(self):
  self.server.control='no-store'
  _,receipt=self.get(policy_check=lambda url:{**policy(url),'reuse_allowed':False})
  self.assertFalse(receipt['retain_body']);self.assertFalse((self.root/'objects').exists())
 def test_capture_replay_preserves_original_payload_and_rejects_changed_source(self):
  import base64,sqlite3
  from scripts.market_map import contact_observation_store as store
  _,receipt=self.get()
  page={'capture_id':receipt['capture_id'],'url':receipt['url'],'checked_at':receipt['captured_at'],'content_sha256':receipt['sha256'],'raw_body_base64':base64.b64encode(BODY).decode(),'parser_version':'one'}
  db=sqlite3.connect(':memory:');store.initialize(db);store.capture(db,page)
  original=db.execute('SELECT * FROM captures').fetchone()
  store.capture(db,{**page,'parser_version':'two'})
  self.assertEqual(db.execute('SELECT * FROM captures').fetchall(),[original])
  with self.assertRaises(ValueError):store.capture(db,{**page,'checked_at':'2099-01-01'})
  db.close()
