import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'scripts'))
from market_map.relationship_email_bridge import ingest
from market_map.email_acquisition import connect


class RelationshipEmailBridgeTests(unittest.TestCase):
    @patch('market_map.email_acquisition.storage_guard')
    def test_quality_retraction_holds_candidate_only_domain_and_restores_on_new_support(self, guard):
        with tempfile.TemporaryDirectory() as folder:
            source=Path(folder)/'evidence.jsonl';queue=Path(folder)/'queue.sqlite'
            row=dict(candidate_id='candidate',name='Candidate',website_url='https://candidate.test/',source_url='https://source.test/partners',relationship_type='listed_partner_of',evidence_id='edge',resolution_status='direct_link_candidate')
            source.write_text(json.dumps(row));ingest(source,queue)
            source.write_text(json.dumps(dict(row,resolution_status='context_review')));ingest(source,queue)
            db=connect(queue)
            self.assertEqual(db.execute('SELECT status FROM jobs').fetchone()[0],'relationship_quality_review_hold')
            self.assertEqual(db.execute('SELECT COUNT(*) FROM relationship_discovery_evidence').fetchone()[0],2)
            db.close()
            source.write_text(json.dumps(row));ingest(source,queue)
            db=connect(queue)
            self.assertEqual(db.execute('SELECT status FROM jobs').fetchone()[0],'pending')
            db.close()

    @patch('market_map.email_acquisition.storage_guard')
    def test_shared_target_preserves_edges_and_replay_without_duplicate_job(self, guard):
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / 'candidates.jsonl'; queue = Path(folder) / 'queue.sqlite'
            row = dict(candidate_id='target', name='Target Company', website_url='https://target.test/', source_url='https://origin.test/partners', source_domain='origin.test', relationship_type='listed_partner_of', evidence_id='claim1', resolution_status='direct_link_candidate', geography_status='unknown', discovery_depth=1)
            source.write_text('\n'.join(json.dumps(r) for r in (row, dict(row, evidence_id='claim2', source_url='https://second.test/clients'))))
            self.assertEqual(ingest(source, queue)['new_provenance_rows'], 2)
            self.assertEqual(ingest(source, queue)['new_provenance_rows'], 0)
            db = connect(queue)
            self.assertEqual(db.execute('SELECT COUNT(*) FROM jobs').fetchone()[0], 1)
            self.assertEqual(db.execute('SELECT COUNT(*) FROM relationship_discovery_evidence').fetchone()[0], 2)
            self.assertEqual(db.execute('SELECT organisation_id FROM associations').fetchone()[0], 'relationship-candidate:target')
            with db:
                db.execute("UPDATE jobs SET status='known_frontier_processed'")
                db.execute("UPDATE frontier SET status='observed'")
            db.close()
            source.write_text(json.dumps(dict(row, website_url='https://target.test/contact', evidence_id='claim3')))
            ingest(source, queue)
            db = connect(queue)
            self.assertEqual(db.execute('SELECT status FROM jobs').fetchone()[0], 'pending')
            self.assertEqual(db.execute('SELECT COUNT(*) FROM jobs').fetchone()[0], 1)
            db.close()

    @patch('market_map.email_acquisition.storage_guard')
    def test_unresolved_names_and_social_links_remain_review_evidence(self, guard):
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / 'candidates.jsonl'; queue = Path(folder) / 'queue.sqlite'
            row = dict(candidate_id='target', name='Unknown', source_url='https://origin.test/partners', relationship_type='listed_partner_of', evidence_id='claim', resolution_status='unresolved_name', website_url='')
            source.write_text('\n'.join(json.dumps(r) for r in (row, dict(row, candidate_id='social', resolution_status='direct_link_candidate', website_url='https://facebook.com/example'), dict(row, candidate_id='form', name='GET YOUR PROJECT STARTED', resolution_status='direct_link_candidate', website_url='https://forms.hsforms.com/contact'))))
            self.assertEqual(ingest(source, queue)['held_candidates'], 3)
            db = connect(queue)
            self.assertEqual(db.execute('SELECT COUNT(*) FROM jobs').fetchone()[0], 0)
            self.assertEqual(db.execute('SELECT COUNT(*) FROM relationship_discovery_evidence').fetchone()[0], 3)
            db.close()


if __name__ == '__main__':
    unittest.main()
