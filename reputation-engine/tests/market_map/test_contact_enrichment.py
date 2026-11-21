import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch
from scripts.market_map.contact_enrichment import connect,seed,persist,summary,run,mine_browser,collect_domain,link_priority
from scripts.market_map.transport import Response


class ContactEnrichmentTests(unittest.TestCase):
    def source(self,root):
        path=root/'email.sqlite';db=sqlite3.connect(path)
        db.executescript('CREATE TABLE jobs(domain TEXT,url TEXT,status TEXT);CREATE TABLE email_evidence(domain TEXT,source_url TEXT);')
        db.executemany('INSERT INTO jobs VALUES(?,?,?)',[('one.test','https://one.test/','pending'),('two.test','https://two.test/','relationship_quality_review_hold'),('no-email.test','https://no-email.test/','pending')])
        db.executemany('INSERT INTO email_evidence VALUES(?,?)',[('one.test','https://directory.test/one'),('two.test','https://two.test/contact'),('not-a-website.test','https://directory.test/other')]);db.commit();db.close();return path

    def test_team_links_precede_general_pages(self):
        links=['https://one.test/about','https://one.test/locations','https://one.test/team','https://one.test/leadership']
        ordered=sorted(links,key=link_priority)
        self.assertEqual(ordered[:2],['https://one.test/leadership','https://one.test/team'])
        self.assertEqual(ordered[-1],'https://one.test/about')

    @patch('scripts.market_map.contact_enrichment.storage_guard')
    def test_seed_only_existing_email_domains_preserves_provider_attribution(self,guard):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);source=self.source(root);before=source.read_bytes();db=connect(root/'context.sqlite')
            self.assertEqual(seed(db,source),3);seed(db,source)
            self.assertEqual(db.execute('SELECT COUNT(*) FROM jobs').fetchone()[0],3)
            self.assertEqual(db.execute("SELECT status FROM jobs WHERE domain='two.test'").fetchone()[0],'upstream_review_hold')
            self.assertEqual(before,source.read_bytes());db.close()

    @patch('scripts.market_map.contact_enrichment.storage_guard')
    def test_timeout_checkpoint_keeps_person_claim_without_authority_inference(self,guard):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);db=connect(root/'context.sqlite');seed(db,self.source(root))
            result={'domain':'one.test','job_status':'domain_timeout_review','claims':[{'claim_type':'people','evidence':{'name':'Example Person','role_title':'Facilities Manager','authority_scope':'not_established','source_url':'https://one.test/team','review_status':'candidate'}}]}
            persist(db,result);persist(db,result)
            report=summary(db);self.assertEqual(report['people_candidate_observations'],1);self.assertEqual(report['purchasing_authority_verified'],0)
            self.assertEqual(db.execute("SELECT status FROM frontier WHERE domain='one.test'").fetchone()[0],'pending');db.close()

    @patch('scripts.market_map.contact_enrichment.storage_guard')
    def test_worker_error_is_durable_and_exported(self,guard):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);overlay=root/'overlay.json';overlay.write_text('{}')
            def broken(job,frontier):raise RuntimeError('fixture')
            run(self.source(root),root/'out',overlay,collector=broken)
            report=json.loads((root/'out/status.json').read_text());self.assertEqual(report['job_status_counts']['domain_worker_error_review'],2)
            self.assertTrue((root/'out/public-contact-context.csv').exists())

    @patch('scripts.market_map.contact_enrichment.storage_guard')
    def test_overlay_hold_prevents_fetch(self,guard):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);overlay=root/'overlay.json';overlay.write_text(json.dumps({'reviews':{'one.test':{'reuse_status':'hold_pending_permission'}}}))
            def forbidden(job,frontier):self.fail('Held domain visited')
            run(self.source(root),root/'out',overlay,collector=forbidden)
            report=json.loads((root/'out/status.json').read_text());self.assertEqual(report['job_status_counts']['manual_identity_or_reuse_hold'],1)

    @patch('scripts.market_map.contact_enrichment.Transport')
    def test_real_extractor_keeps_role_and_same_site_frontier(self,transport):
        body=b'<main><div class="team-card"><h3>Jane Smith</h3><p>Facilities Manager</p><a href="mailto:jane@one.test">Email</a></div><a href="/team">Team</a></main>'
        client=transport.return_value;client.fetch.return_value=Response(body,{'content-type':'text/html'},'https://one.test/')
        client.metrics.return_value={'requests':1,'bytes_fetched':len(body)}
        result=collect_domain({'domain':'one.test'},[{'url':'https://one.test/','depth':0}],page_limit=1)
        person=next(c['evidence'] for c in result['claims'] if c['claim_type']=='people')
        self.assertEqual(person['name'],'Jane Smith');self.assertEqual(person['authority_scope'],'not_established')
        self.assertIn(('https://one.test/team',1,'pending'),result['discovered'])

    @patch('scripts.market_map.contact_enrichment.storage_guard')
    def test_saved_browser_miner_isolates_bad_artifact_and_replays(self,guard):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);db=connect(root/'context.sqlite');seed(db,self.source(root))
            bad=root/'browser/pages/bad';bad.mkdir(parents=True)
            (bad/'rendered-dom.html').write_text('<p>bad</p>');(bad/'browser-capture-manifest.json').write_text('{')
            good=root/'browser/pages/good';good.mkdir()
            (good/'browser-capture-manifest.json').write_text(json.dumps({'source_url':'https://one.test/','status':'captured_with_rendering_gaps'}))
            (good/'rendered-dom.html').write_text('<main><p>We are a registered charity.</p></main>')
            self.assertEqual(mine_browser(db,root/'browser',{}),1);self.assertEqual(mine_browser(db,root/'browser',{}),0)
            self.assertEqual(summary(db)['organisation_classification_observations'],1)
            self.assertEqual(db.execute("SELECT COUNT(*) FROM metadata WHERE key LIKE 'browser_mine_error:%'").fetchone()[0],1);db.close()


if __name__=='__main__':unittest.main()
