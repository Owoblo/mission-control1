import csv
import gzip
import io
import json
from pathlib import Path
import tempfile
import unittest
from scripts.market_map.toronto_full import classify,partition,sha,apply_acquisition
from scripts.market_map.transport import SourceBlocked

SOURCE={'source_url':'https://official.test/rows.csv'}
def record(**changes):
    r={'Licence No.':'B01-1','Operating Name':'Fixture Repair','Client Name':'None','Cancel Date':'None','Category':'Repair shop','Licence Address Line 1':'12 Main St','Licence Address Line 2':'TORONTO ON','Licence Address Line 3':'M1A 1A1','Last Record Update':'2026-10-24'}
    r.update(changes);return r

class TorontoFullTests(unittest.TestCase):
    def test_literal_null_cancellation_is_not_cancelled_and_raw_unchanged(self):
        r=record();status,row,reason=classify(r,SOURCE,'2026-10-26')
        self.assertEqual(status,'candidate');self.assertEqual(row['raw_payload']['Cancel Date'],'None')
        self.assertFalse(row['campaign_ready']);self.assertEqual(row['city'],'TORONTO')
    def test_cancelled_and_bad_date_are_distinct(self):
        self.assertEqual(classify(record(**{'Cancel Date':'2020-01-02'}),SOURCE,'x')[0],'cancelled')
        self.assertEqual(classify(record(**{'Cancel Date':'unexpected'}),SOURCE,'x')[0],'quarantined')
    def test_null_names_and_numbers_not_entities(self):
        for r in [record(**{'Operating Name':'None','Client Name':'null'}),record(**{'Licence No.':'NaN'})]:
            self.assertEqual(classify(r,SOURCE,'x')[0],'quarantined')
    def fixture(self,folder,rows):
        buf=io.StringIO();w=csv.DictWriter(buf,fieldnames=list(rows[0]));w.writeheader();w.writerows(rows)
        with gzip.open(folder/'publisher-full.csv.gz','wt') as f:f.write(buf.getvalue())
        return partition(folder,{'url':SOURCE['source_url'],'last_modified':'2026-10-24'}, {'requests':3,'bytes_fetched':123,'estimated_cost':0},'2026-10-26')
    def test_all_rows_and_duplicate_numbers_preserved(self):
        with tempfile.TemporaryDirectory() as tmp:
            p=Path(tmp);m=self.fixture(p,[record(),record(),record(**{'Licence No.':'B01-2','Cancel Date':'2020-01-01'}),record(**{'Licence No.':'B01-3','Operating Name':'=Formula'})])
            self.assertEqual(m['raw_rows'],4);self.assertEqual(m['partitions'],{'quarantined':2,'cancelled':1,'candidate':1})
            self.assertFalse(m['coverage_complete']);self.assertTrue(m['source_query_exhausted'])
            with gzip.open(p/'licence-business-candidates.csv.gz','rt') as f:
                self.assertTrue(list(csv.DictReader(f))[0]['name'].startswith("'="))
            for filename,v in m['files'].items():self.assertEqual(sha(p/filename),v['sha256'])
    def test_bad_csv_cannot_claim_empty_completion(self):
        with tempfile.TemporaryDirectory() as tmp:
            p=Path(tmp)
            with gzip.open(p/'publisher-full.csv.gz','wt') as f:f.write('foo,bar\nx,y\n')
            with self.assertRaises(SourceBlocked):partition(p,{'url':'https://x.test/a'}, {},'x')
            self.assertFalse((p/'manifest.json').exists())
    def test_apply_replay_atomic_and_cost_not_inflated(self):
        from scripts.market_map.store import MarketMap
        with tempfile.TemporaryDirectory() as tmp:
            p=Path(tmp);self.fixture(p,[record(),record(**{'Licence No.':'B01-2','Operating Name':'Fixture Two'})])
            store=MarketMap(':memory:')
            a=apply_acquisition(store,p,batch_size=1);before=store.db.execute('select count(*) from source_runs').fetchone()[0]
            b=apply_acquisition(store,p,batch_size=1)
            self.assertEqual(a['processed_rows'],2);self.assertEqual(b['replayed_batches'],2)
            self.assertEqual(store.db.execute('select count(*) from source_runs').fetchone()[0],before)
            with (p/'candidate.jsonl.gz').open('ab') as f:f.write(b'bad')
            with self.assertRaises(SourceBlocked):apply_acquisition(store,p)
