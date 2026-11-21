import hashlib
import json
from pathlib import Path
import sqlite3
import tempfile
import time
import unittest
from scripts.market_map.relationship_queue import seed,connect,bounded_observe,sync_state,initialise
from scripts.market_map.relationship_observations import WaveBudget


def stalled_fixture_worker(job,output,overlay,max_pages,max_depth):time.sleep(3)


class RelationshipQueueTests(unittest.TestCase):
    def test_full_seed_is_read_only_and_replay_preserves_exact_associations(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);source=root/'source.sqlite';connection=sqlite3.connect(source)
            connection.executescript('CREATE TABLE jobs(domain TEXT PRIMARY KEY,url TEXT,priority TEXT);CREATE TABLE associations(organisation_id TEXT,domain TEXT,url TEXT,name TEXT,raw_domain TEXT,PRIMARY KEY(organisation_id,domain,url)) WITHOUT ROWID;')
            connection.executemany('INSERT INTO jobs VALUES(?,?,?)',[('a.ca','https://a.ca/','1'),('b.ca','https://b.ca/','2')])
            connection.executemany('INSERT INTO associations VALUES(?,?,?,?,?)',[('001','a.ca','https://a.ca/','Example A','a.ca'),('002','a.ca','https://a.ca/contact','Example Branch','A.CA'),('003','b.ca','https://b.ca/','Example B','b.ca')]);connection.commit();connection.close()
            original=hashlib.sha256(source.read_bytes()).hexdigest();report=seed(source,root/'derived',chunk=1);replay=seed(source,root/'derived',chunk=1)
            self.assertEqual(report['source_counts'],{'domains':2,'associations':3});self.assertEqual(report['derived_counts'],replay['derived_counts'])
            self.assertEqual(hashlib.sha256(source.read_bytes()).hexdigest(),original)
            with connect(root/'derived'/'queue.sqlite',True) as derived:
                self.assertEqual(derived.execute('SELECT organisation_id FROM associations ORDER BY organisation_id').fetchone()[0],'001')
                self.assertEqual(derived.execute('SELECT COUNT(*) FROM frontier').fetchone()[0],2)

    def test_stalled_domain_preserves_saved_receipts_and_marks_unknown_meters(self):
        with tempfile.TemporaryDirectory() as folder:
            output=Path(folder);(output/'domains').mkdir();job={'job_id':'fixture','domain':'fixture.ca','candidate_urls':['https://fixture.ca/'],'organisations':[]}
            state={**job,'frontier':[{'url':'https://fixture.ca/clients','depth':1,'kind':'relationship_page','status':'pending'}],
                'pages':[{'content_sha256':'original-page-hash'}],'claims':[{'observation_id':'original-claim'}],'invocations':[],'status':'wave_page_or_depth_limit_frontier_retained'}
            path=output/'domains'/'fixture.json';path.write_text(json.dumps(state));budget=WaveBudget()
            result=bounded_observe(job,output,{},budget,timeout_seconds=.2,worker_target=stalled_fixture_worker)
            self.assertEqual(result['status'],'domain_walltime_requires_review');self.assertEqual(result['pages'],state['pages']);self.assertEqual(result['claims'],state['claims'])
            self.assertIsNone(result['invocations'][-1]['transport']['requests']);self.assertEqual(budget.reserved,0)


if __name__=='__main__':unittest.main()
