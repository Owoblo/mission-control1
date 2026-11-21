import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('worker',Path(__file__).with_name('worker.py'))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

class ResearchTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.w=m.Worker(self.temp.name)
    def tearDown(self):self.w.db.close();self.temp.cleanup()
    def test_aliases_do_not_repeat_fund_discovery(self):
        self.w.enqueue('fund','Canaan Partners','https://canaan.com')
        self.w.enqueue('fund','Canaan','https://canaan.com/team')
        self.assertEqual(self.w.db.execute('select count(*) from tasks').fetchone()[0],1)
    def test_missing_email_keeps_person_and_queues_profile(self):
        r=dict(name='Jane Smith',entity_type='person',role='Executive Assistant',email='guessed@example.com',
            profile_url='https://example.com/jane',source_url='https://example.com/team',
            evidence='Jane Smith Executive Assistant',relationship='Team member',fit='Non-investment staff')
        with patch.object(self.w,'capture',return_value={'text':'Jane Smith Executive Assistant','links':[]}):
            self.w.ingest({'id':1,'kind':'team_page','name':'fund','depth':0,'url':''},
                {'records':[r],'gaps':[],'next_urls':[]})
        row=self.w.db.execute('select * from records').fetchone()
        self.assertEqual(row['email'],'');self.assertEqual(row['name'],'Jane Smith')
        self.assertEqual(row['source_status'],'captured_name_and_quote')
        self.assertEqual(self.w.db.execute("select count(*) from tasks where kind='profile'").fetchone()[0],1)
    def test_shared_mailbox_is_not_person_verified(self):
        r=dict(name='Jane Smith',entity_type='person',role='Partner',email='info@example.com',
            profile_url='',source_url='https://example.com/team',evidence='Jane Smith Partner',relationship='Team',fit='')
        with patch.object(self.w,'capture',return_value={'text':'Jane Smith Partner info@example.com','links':[]}):
            self.w.ingest({'id':1,'kind':'team_page','name':'fund','depth':0,'url':''},{'records':[r],'gaps':[],'next_urls':[]})
        self.assertEqual(self.w.db.execute('select email_status from records').fetchone()[0],'published_on_source_association_review')
    def test_budget_blocks_before_http(self):
        self.w.max_calls=0
        with patch.object(self.w,'prompt',return_value=('test',{},False)),patch.object(m.urllib.request,'urlopen') as http:
            with self.assertRaisesRegex(RuntimeError,'budget_hold'):self.w.call({'id':1})
            http.assert_not_called()
    def test_private_targets_rejected(self):
        with patch.object(m.socket,'getaddrinfo',return_value=[(2,1,6,'',('127.0.0.1',443))]):
            with self.assertRaises(ValueError):m.public_url('https://example.com')
    def test_component_roster_extracts_people_not_portfolio_names(self):
        page=m.Page();page.feed('<team-grid :team-data="[{&quot;name&quot;:&quot;Jane Smith&quot;,&quot;link&quot;:&quot;/team/jane&quot;,&quot;companies&quot;:[{&quot;name&quot;:&quot;Other Company&quot;}]}]"></team-grid>')
        self.assertIn('Jane Smith',page.text);self.assertNotIn('Other Company',page.text)
        self.assertEqual(page.links,[['/team/jane','Jane Smith']])
    def test_final_structured_message_after_intermediate_text(self):
        data={'output':[{'content':[{'type':'output_text','text':'Searching now.'}]},{'content':[{'type':'output_text','text':'{"records":[],"gaps":[],"next_urls":[]}'}]}]}
        self.assertEqual(m.parse_result(data)['records'],[])
    def test_scheduling_does_not_starve_investor_expansion(self):
        for i in range(10):self.w.enqueue('team_page','fund',f'https://example.com/{i}')
        self.w.enqueue('company','Bellhop')
        self.assertEqual(self.w.next_task()['kind'],'company')
    def test_budget_hold_still_allows_free_profile_collection(self):
        self.w.enqueue('company','Bellhop');self.w.enqueue('profile','Jane','https://example.com/jane')
        self.w.hold='budget_hold';self.assertEqual(self.w.next_task()['kind'],'profile')
    def test_literal_click_email_without_executing_javascript(self):
        raw='document.getElementById("email").onclick = function() {var email = "mailto:ccuffaro".concat("@", "canaan.com");window.location.href=email;}'
        self.assertEqual(m.click_emails(raw),['ccuffaro@canaan.com'])
        self.assertEqual(m.click_emails('onclick=function(){"mailto:a".concat(window.secret,"@x.com")}'),[])
        self.assertEqual(m.click_emails('var unrelated="mailto:a".concat("@","x.com")'),[])
    def test_all_people_exported_and_repeat_observations_deduped(self):
        r=dict(name='Jane Smith',entity_type='person',role='Assistant',email='',profile_url='',source_url='',evidence='',relationship='',fit='')
        for task in (1,2):self.w.ingest({'id':task,'kind':'team_page','name':'fund','depth':0,'url':''},{'records':[r],'gaps':[],'next_urls':[]})
        self.w.export()
        self.assertEqual(len((Path(self.temp.name)/'people-leads.csv').read_text().splitlines()),2)
    def test_published_embedded_email_formats(self):
        address='jane@example.com'
        encoded=bytes([42]+[b^42 for b in address.encode()]).hex()
        fixtures=[
            '<script type="application/ld+json">{"@type":"Person","email":"jane@example.com"}</script>',
            '<script type="application/json">{"props":{"people":[{"emailAddress":"jane@example.com"}]}}</script>',
            '<button data-email="jane&#64;example.com">Email</button>',
            '<meta itemprop="email" content="jane@example.com">',
            '<p>jane [at] example [dot] com</p>',
            f'<a data-cfemail="{encoded}">[email protected]</a>',
            '''<script>email.onclick=function(){location.href="mailto:"+"jane"+"@example.com";}</script>'''
        ]
        for raw in fixtures:
            with self.subTest(raw=raw):
                page,_=m.parse_page(raw)
                self.assertIn('mailto:'+address,[h for h,_ in page.links])
    def test_no_email_patterns_variables_or_unrelated_script_strings(self):
        fixtures=[
            '<p>Jane Smith works at Example. Domain: example.com</p>',
            '<script type="application/json">{"name":"Jane","domain":"example.com","debug":"jane@example.com"}</script>',
            '<script>var telemetry="jane@example.com";</script>',
            '''<script>email.onclick=function(){location.href="mailto:"+first+"@example.com";}</script>''',
            '''<script>email.onclick=function(){location.href="mailto:"+"jane@example.com"+suffix;}</script>''',
            '<a data-cfemail="invalid">Email</a>'
        ]
        for raw in fixtures:
            with self.subTest(raw=raw):
                page,_=m.parse_page(raw)
                self.assertFalse([h for h,_ in page.links if h.startswith('mailto:')])
    def test_cached_pages_reparsed_without_network(self):
        import hashlib,json
        url='https://example.com/people/jane';digest=hashlib.sha256(url.encode()).hexdigest()
        folder=Path(self.temp.name)/'sources';folder.mkdir(exist_ok=True)
        (folder/(digest+'.html')).write_text('<button data-email="jane@example.com">Email</button>')
        path='sources/'+digest+'.json'
        (Path(self.temp.name)/path).write_text(json.dumps({'parser_version':3,'text':'Email','links':[],'status':'captured'}))
        self.w.db.execute('INSERT INTO captures VALUES(?,?,?)',(url,path,'captured'));self.w.db.commit()
        with patch.object(m,'public_url',side_effect=AssertionError('No new fetch')):
            page=self.w.capture(url)
        self.assertEqual(page['parser_version'],m.PARSER_VERSION)
        self.assertIn('mailto:jane@example.com',[h for h,_ in page['links']])

if __name__=='__main__':unittest.main()
