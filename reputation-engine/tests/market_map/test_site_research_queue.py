import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
from scripts.market_map.site_research_queue import SiteResearchQueue


class SiteQueueTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.ledger = self.root/'ledger.jsonl'
        self.old = self.root/'old.sqlite'
        self.new = self.root/'new.sqlite'
        rows = [dict(building_id=b, candidate_addresses=[a], research_district=d) for b,a,d in [
            ('a','123 Main St','Centre'), ('b','123 MAIN ST','Centre'),
            ('c','123 Main St UNIT 2','Centre'), ('d','123 Main St','East'),
            ('e','Main St','Centre')]]
        self.ledger.write_text('\n'.join(json.dumps(r) for r in rows))
        db = sqlite3.connect(self.old)
        db.execute('CREATE TABLE building_items(building_id,state,snapshot,attempts,available_at)')
        db.executemany('INSERT INTO building_items VALUES(?,?,?,?,?)', [(r['building_id'],'pending',json.dumps(r),0,0) for r in rows])
        db.commit()
        db.close()
        self.before = self.old.read_bytes()
        self.q = SiteResearchQueue(self.new)
        self.q.import_legacy(self.ledger,self.old,'Windsor')

    def tearDown(self):
        self.q.close()
        self.tmp.cleanup()

    def test_scope_units_idempotence_and_readonly(self):
        self.assertEqual(self.q.status()['sites_by_state'], {'pending':3,'needs_review':1})
        self.assertEqual(self.q.status()['building_memberships'],5)
        self.q.import_legacy(self.ledger,self.old,'Windsor')
        self.assertEqual(self.q.status()['building_memberships'],5)
        self.assertEqual(self.before,self.old.read_bytes())

    def test_exclusive_claim_expiry_and_receipts(self):
        first = self.q.claim('Windsor','East','one',lease_seconds=10,now=100)
        other = SiteResearchQueue(self.new)
        try:
            self.assertIsNone(other.claim('Windsor','East','two',now=101))
            second = other.claim('Windsor','East','two',now=111)
            receipt = {'url':'https://example.org','sha256':'a'*64,'retrieved_at':'2026-10-30'}
            with self.assertRaises(ValueError):
                self.q.finish(first['site_id'],first['token'],[receipt],now=112)
            other.finish(second['site_id'],second['token'],[receipt],needs_review=False,now=112)
            self.q.import_legacy(self.ledger,self.old,'Windsor')
            self.assertIsNone(self.q.claim('Windsor','East','three',now=113))
            saved = json.loads(self.q.db.execute('SELECT receipt FROM evidence').fetchone()[0])
            self.assertFalse(saved['occupancy_verified'])
            self.assertEqual(self.before,self.old.read_bytes())
        finally:
            other.close()

    def test_retries_and_max_attempts(self):
        first = self.q.claim('Windsor','East','one',now=100)
        self.q.fail(first['site_id'],first['token'],'timeout',retry_delay=5,max_attempts=2,now=101)
        self.assertIsNone(self.q.claim('Windsor','East','one',now=105))
        second = self.q.claim('Windsor','East','one',max_attempts=2,now=106)
        self.q.fail(second['site_id'],second['token'],'timeout',max_attempts=2,now=107)
        self.assertIsNone(self.q.claim('Windsor','East','one',now=500))
        self.assertEqual(self.q.status()['sites_by_state']['exhausted'],1)

    def test_shared_address_preserves_building_ids(self):
        claimed = [self.q.claim('Windsor','Centre','one',now=100),self.q.claim('Windsor','Centre','two',now=100)]
        self.assertEqual(sorted(len(c['members']) for c in claimed),[1,2])
        for c in claimed:
            for m in c['members']:
                self.assertFalse(m['identity_merge_permitted'])
        self.assertEqual({m['building_id'] for c in claimed for m in c['members']},{'a','b','c'})

    def test_legacy_constructor_protection(self):
        with self.assertRaises(ValueError):
            SiteResearchQueue(self.old)
        self.assertEqual(self.before,self.old.read_bytes())

    def test_address_changes_require_reconciliation(self):
        rows = [json.loads(line) for line in self.ledger.read_text().splitlines()]
        rows[0]['candidate_addresses'] = ['999 Other St']
        self.ledger.write_text('\n'.join(json.dumps(r) for r in rows))
        with self.assertRaises(ValueError):
            self.q.import_legacy(self.ledger,self.old,'Windsor')
        self.assertEqual(self.q.status()['building_memberships'],5)
        self.assertEqual(self.before,self.old.read_bytes())

    def test_heartbeat_does_not_revive_expired_lease(self):
        c = self.q.claim('Windsor','East','one',lease_seconds=10,now=100)
        self.q.heartbeat(c['site_id'],c['token'],lease_seconds=20,now=109)
        self.assertIsNone(self.q.claim('Windsor','East','two',now=120))
        with self.assertRaises(ValueError):
            self.q.heartbeat(c['site_id'],c['token'],now=130)

    def test_no_source_no_completion(self):
        c = self.q.claim('Windsor','East','one',now=100)
        with self.assertRaises(ValueError):
            self.q.finish(c['site_id'],c['token'],[],now=101)
        self.assertEqual(self.q.status()['sites_by_state']['claimed'],1)


if __name__ == '__main__':
    unittest.main()
