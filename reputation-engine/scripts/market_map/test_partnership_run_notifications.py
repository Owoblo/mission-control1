from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from . import partnership_run_notifications as runs


class PartnershipRunNoticeTests(unittest.TestCase):
    def setUp(self):
        tmp = TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name)
        self.at = datetime(2026, 11, 23, 14, tzinfo=timezone.utc)
        self.day = '2026-11-23'

    def test_geo_report_includes_all_holds_from_both_stages(self):
        folder = self.root/'days'/self.day
        results = folder/'results'
        results.mkdir(parents=True)
        runs.save(results/'verified-contact-inventory.json', {'items': [
            {'id': 'biz1', 'name': 'Test Bakery', 'city': 'Toronto'},
            {'id': 'biz2', 'name': 'Test Shop', 'city': 'Windsor'},
        ]})
        runs.save(folder/'report.json', {'prepared_recipients': 2, 'record_states': {'verified': 2}})
        prep = results/'geo-sms-preparation.json'
        runs.save(prep, {'holds': {'biz1': ['verify_mobile']}})
        receipt = {'mode': 'execute', 'scheduled': 0, 'held': [{'id': 'biz2', 'reasons': ['copy_review']}]}
        [report] = runs.run_notices(folder, self.day, 'B2B', 'geo', results, prep, receipt)
        self.assertEqual(dict(report['metrics'])['Review records'], '2')
        self.assertEqual([row['name'] for row in report['review']], ['Test Bakery', 'Test Shop'])

    def test_transport_replay_uses_frozen_payload_and_records_success_once(self):
        payload = runs.notice(self.day, 'B2B', 'geo', 'run', {'scheduled': 5})
        calls = []
        def sender(message):
            calls.append(message)
            if len(calls) == 1:
                raise TimeoutError()
            return {'state': 'accepted', 'providerId': 'fixture'}
        with self.assertRaises(TimeoutError):
            runs.send_once(self.root, payload, self.at, sender)
        runs.send_once(self.root, payload, self.at + timedelta(minutes=1), sender)
        later = self.at + timedelta(minutes=6)
        runs.send_once(self.root, {**payload, 'metrics': [['scheduled', '6']]}, later, sender)
        runs.send_once(self.root, payload, later + timedelta(minutes=10), sender)
        self.assertEqual(calls, [payload, payload])
        self.assertTrue(runs.already_saved(self.root, payload).is_file())

    def test_delivery_distinguishes_accepted_delivered_failed_and_open_job(self):
        receipt = {'campaign_key': 'geo-campaign', 'scheduled': 2}
        rows = [
            {'id': 'a', 'status': 'sent', 'provider_sid': 'message-a'},
            {'id': 'b', 'status': 'sent', 'provider_sid': 'message-b'},
        ]
        events = [
            {'message_key': 'message-a', 'status': 'delivered', 'occurred_at': self.at.isoformat()},
            {'message_key': 'message-b', 'status': 'delivery_failed', 'occurred_at': self.at.isoformat()},
        ]
        def db(table, *args, **kwargs):
            return rows if table == 'sequence_jobs' else events
        [report] = runs.delivery_notice(self.day, 'B2B', 'geo', receipt, self.at, db)
        metrics = dict(report['metrics'])
        self.assertEqual((metrics['Provider accepted'], metrics['Confirmed delivered'], metrics['Provider delivery failures']),
                         ('2', '1', '1'))
        rows[0].update(status='pending', scheduled_at=self.at.isoformat())
        self.assertEqual(list(runs.delivery_notice(self.day, 'B2B', 'geo', receipt, self.at, db)), [])
        [warning] = runs.delivery_notice(self.day, 'B2B', 'geo', receipt, self.at + timedelta(hours=3), db)
        self.assertEqual(warning['kind'], 'issue')

    def test_carrier_and_promotion_errors_get_stable_separate_alerts(self):
        path = self.root/'promotion-attempt.json'
        runs.save(path, {'state': 'unconfirmed', 'http_status': 503, 'at': self.at.isoformat()})
        [issue] = runs.issues_for(self.day, 'Realtor', 'export', [path])
        self.assertIn('promotion-attempt:503', issue['id'])
        self.assertEqual(list(runs.issues_for('2026-11-24', 'Realtor', 'export', [path])), [])

    def test_billing_checks_are_hourly_and_low_funds_are_notification_only(self):
        calls = []
        def reader(_root, provider):
            calls.append(provider)
            if provider == 'Telnyx':
                return {'balance': '-5', 'available': '20', 'currency': 'USD'}
            return {'balance': '100', 'available': '100', 'currency': 'CAD'}
        snapshot = runs.refresh_billing(self.root, self.root, self.at, reader)
        [warning] = runs.balance_notices(self.day, snapshot, {'telnyx': 25, 'twilio': 25})
        self.assertIn('telnyx:low', warning['id'])
        self.assertEqual(dict(warning['metrics'])['Available'], '20.00 USD')
        runs.refresh_billing(self.root, self.root, self.at + timedelta(minutes=59), reader)
        self.assertCountEqual(calls, ['Twilio', 'Telnyx'])
        runs.refresh_billing(self.root, self.root, self.at + timedelta(hours=1), reader)
        self.assertEqual(len(calls), 4)

    def test_openai_cost_and_quota_yield_distinct_alerts(self):
        runs.save(self.root/'api-usage.json', {'quota_exhausted': True})
        report = {'worker': {'estimated_model_token_usd': 12.5}}
        alerts = list(runs.openai_cost_notices(self.day, report, self.root, runs.billing_amount(10)))
        self.assertEqual([x['id'].split(':')[-2] for x in alerts], ['quota', 'spend'])
        self.assertEqual(dict(alerts[1]['metrics'])['Estimated cost USD'], '12.50')

    def test_confidence_labels_distinguish_source_gaps_from_eligibility_holds(self):
        row = runs.review_row('Fixture Business', 'London', 'held_before_send',
                              ['verify_unique_current_mobile', 'recent_conversation_hold'])
        self.assertTrue(row['state'].startswith('Weak evidence'))
        self.assertIn('confirm the carrier result', row['reasons'])
        self.assertIn('recent_conversation_hold', row['reasons'])
        paused = runs.review_row('Fixture Agent', 'London', 'held', ['suppression_hold'])
        self.assertEqual(paused['state'], 'held')

    def test_large_review_preserves_every_row_beneath_the_endpoint_limit(self):
        row = runs.review_row('Fixture Business', 'London', 'held', ['x' * 490])
        rows = [row] * 4000
        parts = list(runs.split_review_notice(self.day, 'B2B', 'geo', {}, rows))
        self.assertGreater(len(parts), 1)
        self.assertEqual(sum(len(part['review']) for part in parts), len(rows))
        for part in parts:
            self.assertLess(len(json.dumps(part).encode()), 2 * 1024 * 1024)
        self.assertEqual(len(set(part['id'] for part in parts)), len(parts))
