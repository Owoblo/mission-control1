import hashlib
import importlib.util
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
def module(name):
    spec=importlib.util.spec_from_file_location(name,ROOT/'scripts/market_map/cloud'/f'{name}.py')
    value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value);return value
backup=module('backup-research').backup
restore=module('restore-research').restore

class CloudBackupTests(unittest.TestCase):
    def fixture(self,root):
        state=root/'artifacts/windsor-building-ledger-20261029';state.mkdir(parents=True)
        cache=root/'.runtime/trusted-source-cache/objects';cache.mkdir(parents=True)
        body=b'published source evidence';digest=hashlib.sha256(body).hexdigest();raw=cache/(digest+'.body');raw.write_bytes(body)
        receipt=json.dumps({'body_path':str(raw.relative_to(root))}).encode();receiptpath=cache/(hashlib.sha256(receipt).hexdigest()+'.receipt.json');receiptpath.write_bytes(receipt)
        (cache.parent/'collector.key').write_text('must not backup')
        interpretation=root/'artifacts/interpretation.json';interpretation.write_text('{}')
        db=sqlite3.connect(state/'research-queue.sqlite3');db.executescript('CREATE TABLE building_events(body TEXT); CREATE TABLE building_items(state TEXT); CREATE TABLE building_queue_meta(key TEXT,value TEXT);')
        db.execute('INSERT INTO building_events VALUES (?)',(json.dumps({'raw_evidence_reference':str(raw.relative_to(root)),'receipt_path':str(receiptpath.relative_to(root)),'worker_interpretation_reference':str(interpretation.relative_to(root))}),));db.execute("INSERT INTO building_items VALUES ('submitted')");db.commit();db.close()
        (root/'scripts/market_map').mkdir(parents=True);(root/'docs').mkdir();(root/'docs/coverage-expansion-operating-playbook-20261028.txt').write_text('playbook')
        return raw
    def test_roundtrip_trusted_cache_no_key_and_paused(self):
        with tempfile.TemporaryDirectory() as tmp:
            base=Path(tmp);root=base/'source';raw=self.fixture(root)
            result=backup(root,base/'bundles');report=restore(result['backup'],base/'restored')
            self.assertEqual(report['queue_states'],{'submitted':1});self.assertTrue(report['paused'])
            self.assertEqual((base/'restored'/raw.relative_to(root)).read_bytes(),raw.read_bytes())
            self.assertFalse((base/'restored/.runtime/trusted-source-cache/collector.key').exists())
            self.assertTrue((base/'restored/artifacts/interpretation.json').exists())
            with self.assertRaises(ValueError):restore(result['backup'],base/'restored')
    def test_modified_content_addressed_body_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            base=Path(tmp);root=base/'source';raw=self.fixture(root);raw.write_text('changed')
            with self.assertRaises(ValueError):backup(root,base/'bundles')

if __name__=='__main__':unittest.main()
