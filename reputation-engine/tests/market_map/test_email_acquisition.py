import hashlib
import json
import sys
import tempfile
import unittest
from http.client import InvalidURL
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'scripts'))
from market_map.store import MarketMap
from market_map.transport import Response
from market_map.email_acquisition import connect,seed_inventory,seed_pilot,run_workers,summary,import_published_file,collect_domain


class PublicTransport:
    def __init__(self,**kwargs):self.requests=0;self.bytes_fetched=0
    def fetch(self,url,allowed_hosts=None):
        self.requests+=1
        body=b'<title>Example Company</title><a href="/contact">Contact</a><p>info@business.test and purchasing@business.test</p>'
        self.bytes_fetched+=len(body)
        return Response(body,{'Content-Type':'text/html'},url)
    def metrics(self):return {'requests':self.requests,'bytes_fetched':self.bytes_fetched}


class EmailAcquisitionTests(unittest.TestCase):
    @patch('market_map.email_acquisition.Transport')
    def test_invalid_source_url_is_recorded_and_next_page_still_collected(self, transport):
        client = transport.return_value
        client.fetch.side_effect = [InvalidURL('URL contains a space'), Response(b'<p>info@business.test</p>', {'Content-Type':'text/html'}, 'https://business.test/contact')]
        client.metrics.return_value = {'requests':2,'bytes_fetched':30}
        result = collect_domain({'domain':'business.test'}, [{'url':'https://business.test/ /about','depth':0},{'url':'https://business.test/contact','depth':0}], ['Business'])
        self.assertEqual(result['frontier_updates'][0][1], 'typed_failure')
        self.assertEqual(result['frontier_failures'][0]['code'], 'unknown_review')
        self.assertEqual(result['frontier_updates'][1][1], 'observed')
        self.assertEqual(result['emails'][0]['email'], 'info@business.test')

    @patch('market_map.email_acquisition.storage_guard')
    def test_whole_inventory_seeding_dedupes_domains_and_never_changes_source(self,guard):
        with tempfile.TemporaryDirectory() as tmp:
            folder=Path(tmp);main=folder/'main.sqlite';queue=folder/'emails.sqlite'
            store=MarketMap(main);source=store.upsert_source({'id':'source','name':'Source','source_url':'https://source.test'})
            store.ingest(source,[{'source_record_id':'1','name':'One','website':'https://business.test/one'},{'source_record_id':'2','name':'Two','website':'https://www.business.test/two'},{'source_record_id':'3','name':'Three'}]);store.close()
            before=hashlib.sha256(main.read_bytes()).hexdigest()
            first=seed_inventory(main,queue);second=seed_inventory(main,queue)
            self.assertEqual(first['status'],'source_snapshot_sweep_complete')
            self.assertEqual(second['queued_domains'],1)
            self.assertEqual(second['organisation_url_associations'],2)
            self.assertEqual(hashlib.sha256(main.read_bytes()).hexdigest(),before)

    @patch('market_map.email_acquisition.storage_guard')
    @patch('market_map.email_acquisition.Transport',PublicTransport)
    def test_workers_resume_frontier_and_keep_emails_unverified(self,guard):
        with tempfile.TemporaryDirectory() as tmp:
            folder=Path(tmp);queue=folder/'queue.sqlite';plan=folder/'plan.json'
            plan.write_text(json.dumps({'jobs':[{'candidate_urls':['https://business.test/'],'organisations':[{'organisation_id':'1','name':'Example Company'}]}]}))
            seed_pilot(plan,queue)
            first=run_workers(queue,isolate_domains=False,max_domains=1,workers=2,page_limit=1)
            self.assertEqual(first['distinct_published_email_values'],2)
            self.assertEqual(first['job_status_counts']['pending'],1)
            final=run_workers(queue,isolate_domains=False,max_domains=5,workers=2,page_limit=4)
            self.assertEqual(final['distinct_published_email_values'],2)
            self.assertEqual(final['job_status_counts']['known_frontier_processed'],1)
            self.assertEqual(final['mailboxes_verified'],0)
            self.assertEqual(final['messages_sent'],0)

    @patch('market_map.email_acquisition.storage_guard')
    def test_offline_import_preserves_separate_source_associations_and_replays(self,guard):
        with tempfile.TemporaryDirectory() as tmp:
            folder=Path(tmp);queue=folder/'queue.sqlite';data=folder/'emails.jsonl'
            rows=[{'email':'info@business.test','source_url':'https://directory.test/','source_record_id':str(i),'source_id':'directory','organisation_name':'Company '+str(i)} for i in (1,2)]
            data.write_text('\n'.join(json.dumps(row) for row in rows)+'\n')
            self.assertEqual(import_published_file(data,queue)['new_source_email_associations'],2)
            self.assertEqual(import_published_file(data,queue)['new_source_email_associations'],0)
            db=connect(queue)
            try:
                report=summary(db)
                self.assertEqual(report['distinct_published_email_values'],1)
                self.assertEqual(report['email_page_context_associations'],2)
                self.assertEqual(db.execute('SELECT COUNT(*) FROM associations').fetchone()[0],0)
            finally:db.close()


if __name__=='__main__':unittest.main()
