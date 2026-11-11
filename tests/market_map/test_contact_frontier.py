import sqlite3,unittest
from unittest.mock import patch
from scripts.market_map import contact_frontier as f,email_acquisition,phone_acquisition,contact_enrichment
from scripts.market_map.transport import Response
class FrontierTests(unittest.TestCase):
 def test_language_boundaries_query_and_branch(self):
  self.assertGreater(f.score_contact_link('/equipe'),0);self.assertGreater(f.score_contact_link('/nous-joindre'),0)
  self.assertLess(f.score_contact_link('/contact-lenses'),0);self.assertEqual(f.score_contact_link('/shop?next=/contact'),0)
  self.assertGreater(f.score_contact_link('https://a.test/windsor/contact',seed_url='https://a.test/windsor'),f.score_contact_link('https://a.test/contact',seed_url='https://a.test/windsor'))
  self.assertLess(f.score_contact_link('https://user@a.test/contact'),0)
 def test_sort_does_not_release_holds_or_lose_query_identity(self):
  rows=[{'url':'https://a.test/contact?branch=2'},{'url':'https://a.test/contact?branch=1'},{'url':'https://a.test/team','status':'retry_deferred'}]
  self.assertEqual(f.select_frontier(rows,3),f.select_frontier(reversed(rows),3));self.assertEqual(len(f.select_frontier(rows,3)),2)
 def test_shorter_discovery_never_releases_policy_or_retry(self):
  db=sqlite3.connect(':memory:');db.execute('CREATE TABLE frontier(domain,url,depth,status,error,PRIMARY KEY(domain,url))')
  for state in ['depth_deferred','policy_hold','retry_deferred']:
   db.execute('DELETE FROM frontier');db.execute('INSERT INTO frontier VALUES(?,?,?,?,NULL)',('a','url',3,state));f.upsert_link(db,'a','url',1,'pending')
   self.assertEqual(db.execute('SELECT depth,status FROM frontier').fetchone(),(1,'pending' if state=='depth_deferred' else state))
  db.close()
 def test_three_collectors_prioritize_new_contact_with_same_two_page_limit(self):
  home=b'<a href="/about">About</a><a href="/contact-lenses">Shop</a><a href="/contact">Contact</a><a href="/equipe">Equipe</a>'
  for module in [email_acquisition,phone_acquisition,contact_enrichment]:
   with patch.object(module,'Transport') as factory:
    client=factory.return_value;client.metrics.return_value={};trace=[]
    def fetch(url,**kw):trace.append(url);return Response(home if len(trace)==1 else b'<p>desk@business.test</p>',{},url)
    client.fetch.side_effect=fetch
    args=[{'domain':'a.test','url':'https://a.test/'},[{'url':'https://a.test/','depth':0}]]
    if module==email_acquisition:args.append([])
    result=module.collect_domain(*args,page_limit=2)
    self.assertEqual(trace,['https://a.test/','https://a.test/contact']);self.assertFalse(any('contact-lenses' in r[0] for r in result['discovered']))
 def test_redirect_alias_and_held_discovered_link_are_not_refetched(self):
  with patch.object(email_acquisition,'Transport') as factory:
   client=factory.return_value;client.metrics.return_value={};trace=[]
   def fetch(url,**kw):
    trace.append(url)
    return Response(b'<a href="/home">Home contact</a><a href="/contact">Contact</a><a href="/team">Team</a>',{},'https://a.test/home')
   client.fetch.side_effect=fetch
   email_acquisition.collect_domain({'domain':'a.test','blocked_urls':['https://a.test/contact']},[{'url':'https://a.test/','depth':0}],[],page_limit=2)
   self.assertEqual(trace,['https://a.test/','https://a.test/team'])
