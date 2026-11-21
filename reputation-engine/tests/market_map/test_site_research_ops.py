import hashlib
import json
from pathlib import Path
import tarfile
import tempfile
import unittest
from scripts.market_map.site_research_ops import backup,transfer,restore
from scripts.market_map.site_research_queue import SiteResearchQueue


class OpsTests(unittest.TestCase):
    def test_backup_transfer_refresh_preserve_evidence_history(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);(root/'docs').mkdir();(root/'docs/source-first-current-contract.md').write_text('contract')
            (root/'scripts/market_map').mkdir(parents=True)
            body=b'Business at 42 Main St';(root/'body').write_bytes(body)
            src=root/'source.sqlite3';dst=root/'target.sqlite3'
            for db in (src,dst):
                q=SiteResearchQueue(db);q.db.execute('INSERT INTO sites VALUES(?,?,?,?,?,?,0,0,NULL,NULL,NULL,NULL,0)',
                    ('site:a','Windsor','Centre','["42 Main St"]','numbered','pending'));q.close()
            q=SiteResearchQueue(src);site=q.claim('Windsor','Centre','test')
            claim={'organization':'Business','address':'42 Main St','unit':'','occupancy_verified':False}
            result={'claims':[claim],'occupancy_verified':False,'tenant_coverage_complete':False,'requires_review':True}
            q.save_result(site['site_id'],site['token'],result,[{'url':'https://example.org','sha256':hashlib.sha256(body).hexdigest(),
                'retrieved_at':'2026-10-30','body_path':'body'}]);q.close()
            report=backup(src,root,root/'backup.tar.gz')
            with tarfile.open(report['path']) as archive:
                self.assertIn('body',archive.getnames());self.assertIn('sites.sqlite3',archive.getnames())
                self.assertFalse(any('auth' in name for name in archive.getnames()))
            restored=restore(report['path'],root/'restored')
            self.assertEqual(restored['database_integrity'],'ok')
            self.assertEqual((root/'restored/body').read_bytes(),body)
            with self.assertRaises(ValueError):restore(report['path'],root/'restored')
            self.assertEqual(transfer(src,dst,root)['copied_source_assertion_results'],1)
            self.assertEqual(transfer(src,dst,root)['copied_source_assertion_results'],0)
            q=SiteResearchQueue(dst);self.assertIsNone(q.claim('Windsor','Centre','again',include_review=True))
            self.assertEqual(q.requeue('site:a','New source found')['research_revision'],1)
            self.assertEqual(q.db.execute('SELECT count(*) FROM result_history').fetchone()[0],1)
            self.assertEqual(q.db.execute('SELECT count(*) FROM occupant_assertions').fetchone()[0],1)
            self.assertIsNotNone(q.claim('Windsor','Centre','again'));q.close()

    def test_interrupted_uncertain_requests_are_not_auto_claimed(self):
        with tempfile.TemporaryDirectory() as d:
            q=SiteResearchQueue(Path(d)/'q.sqlite3')
            q.db.execute('INSERT INTO sites VALUES(?,?,?,?,?,?,0,0,NULL,NULL,NULL,?,0)',
                ('site:a','Windsor','Centre','[]','unknown','needs_review','interrupted_request_uncertain'))
            self.assertIsNone(q.claim('Windsor','Centre','worker',include_review=True));q.close()


if __name__=='__main__':unittest.main()
