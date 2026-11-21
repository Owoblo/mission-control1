import datetime as dt
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch
from scripts.research_hub.portfolios import Portfolios


class PortfolioTests(unittest.TestCase):
    def test_batch_refresh_failure_does_not_stop_contact_or_listing_loop(self):
        from scripts.research_hub.cloud import run
        root = Path(self.tmp.name)
        (root / '.private').mkdir()
        (root / '.private/listing-research.json').write_text(json.dumps({
            'contact_research_enabled': True, 'team_batch_refresh_enabled': True}))
        stop = Mock()
        stop.is_set.return_value = False
        stop.wait.return_value = True
        child = Mock()
        child.poll.return_value = 0
        with patch('scripts.research_hub.cloud.subprocess.Popen', return_value=child) as launch, patch(
                'scripts.research_hub.team_batch.refresh_captured_batch', side_effect=RuntimeError('test')):
            run(root, stop)
        self.assertEqual(launch.call_count, 2)
        receipt = json.loads((root / 'artifacts/research-hub/contact-routes/batch-supervisor.json').read_text())
        self.assertEqual(receipt['state'], 'refresh_failed_prior_evidence_retained')

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.worker = Portfolios(self.tmp.name)
        self.date = dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=5)

    def tearDown(self):
        self.worker.db.close()
        self.tmp.cleanup()

    def snapshot(self, day, keys, complete=False, **extra):
        return {'person': 'agent:1', 'source': 'test', 'scope': 'all',
                'inventory_kind': 'own', 'observed_at': (self.date + dt.timedelta(days=day)).isoformat(),
                'complete': complete, 'pagination_complete': complete, 'failed_pages': 0,
                'fetch_state': 'success', 'source_url': 'https://example.org/agent',
                'listings': [{'listing_key': key, 'price': 100} for key in keys], **extra}

    def kinds(self):
        return [r[0] for r in self.worker.db.execute('SELECT kind FROM events')]

    def test_partial_scan_cannot_remove_and_complete_scan_tracks_identities(self):
        self.worker.ingest(self.snapshot(0, ['a', 'b'], True))
        self.worker.ingest(self.snapshot(1, ['a']))
        self.assertNotIn('not_shown_in_complete_scan', self.kinds())
        self.worker.ingest(self.snapshot(2, ['a', 'c'], True))
        self.assertIn('first_observed_in_portfolio', self.kinds())
        self.assertIn('not_shown_in_complete_scan', self.kinds())
        event = json.loads(self.worker.db.execute("SELECT payload FROM events WHERE kind='not_shown_in_complete_scan'").fetchone()[0])
        self.assertEqual(event['listing_key'], 'b')
        self.assertFalse(event['sold_or_leased_confirmed'])

    def test_replay_late_input_and_price_change(self):
        first = self.snapshot(0, ['a'])
        self.worker.ingest(first)
        self.assertEqual(self.worker.ingest(first)['state'], 'replay')
        second = self.snapshot(2, ['a'])
        second['listings'][0]['price'] = 200
        self.worker.ingest(second)
        self.assertIn('observed_fields_changed', self.kinds())
        count = len(self.kinds())
        self.worker.ingest(self.snapshot(1, ['z'], True))
        self.assertEqual(len(self.kinds()), count)

    def test_rejects_office_inventory_and_false_completeness(self):
        for changes in ({'inventory_kind': 'office'}, {'failed_pages': 1}, {'pagination_complete': False}, {'fetch_state': 'blocked'}):
            with self.assertRaises(ValueError):
                self.worker.ingest(self.snapshot(0, ['a'], True, **changes))

    def test_scope_and_source_do_not_cross_diff(self):
        self.worker.ingest(self.snapshot(0, ['a'], True))
        self.worker.ingest(self.snapshot(1, [], True, scope='rentals'))
        self.worker.ingest(self.snapshot(2, [], True, source='other'))
        self.assertNotIn('not_shown_in_complete_scan', self.kinds())

    def test_person_portfolio_keeps_sale_rental_and_unknown_mail(self):
        common = {'name': 'Sachin', 'role': 'listing_agent', 'research_at': self.date.isoformat(),
                  'address': '34 Example Dr', 'city': 'Brampton', 'episode_match': 'same_mls_candidate',
                  'existing_record_context': {'directory': {'state': 'existing_directory_candidate', 'identities': ['agent:1']}}}
        rows = [{**common, 'listing_key': 'sale', 'lane': 'residential'},
                {**common, 'listing_key': 'rent', 'lane': 'rental'},
                {**common, 'listing_key': 'office', 'role': 'brokerage_contact'}]
        report = self.worker.export_candidates(rows, {})
        person = report['people'][0]
        self.assertEqual(person['observed_listing_records'], 2)
        self.assertEqual(person['by_lane'], {'residential': 1, 'rental': 1})
        self.assertFalse(person['portfolio_complete'])
        self.assertIsNone(person['confirmed_active_count'])
        self.assertTrue(all(x['mail_eligibility'] == 'not_evaluated' for x in person['listings']))
        before = len(self.kinds())
        self.worker.export_candidates(rows, {})
        self.assertEqual(len(self.kinds()), before)
