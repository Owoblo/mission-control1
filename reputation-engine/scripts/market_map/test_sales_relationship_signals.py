import unittest
from datetime import datetime, timezone

from .prepared_relationship_buffer import build

NOW = datetime(2026, 11, 18, 19, tzinfo=timezone.utc)
CID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
CONTACT = {'id': CID, 'name': 'Partner', 'city': 'Windsor', 'email': 'work@example.com'}


def lead(stage='completed'):
    return {'id': 'lead-test', 'stage': stage, 'source': 'realtor_referral',
            'createdAt': NOW.isoformat(), 'partnerReferralContactId': CID,
            'moveRelationships': [{'contactId': CID, 'role': 'listing_realtor',
                                   'addressConnection': 'origin', 'confidence': 'confirmed'}]}


def packet(row, contact=CONTACT, records=(), tasks=()):
    return build({'priority_review': list(records), 'outstanding_relationship_tasks': list(tasks)},
                 {'items': []}, {'items': []}, NOW, ([row], {CID: contact}))


class SalesRelationshipSignalsTests(unittest.TestCase):
    def test_referrer_and_listing_role_share_one_action(self):
        result = packet(lead())
        row, = result['items']
        signals = row['sales_signal_evidence']['signals']
        self.assertEqual({r['role'] for r in signals}, {'referring_realtor', 'listing_realtor'})
        self.assertEqual(sum(r['actual_referral'] for r in signals), 1)
        self.assertEqual(result['summary']['drafts'], 0)
        self.assertFalse(row['send_ready'])

    def test_active_reply_keeps_priority_and_no_extra_touch(self):
        from .test_prepared_relationship_buffer import record
        context = record('Can you call me?', cid=CID)
        original = build({'priority_review': [context]}, {'items': []}, {'items': []}, NOW)
        row, = packet(lead(), records=[context])['items']
        self.assertEqual(row['priority'], original['items'][0]['priority'])
        self.assertEqual(row['source_fingerprint'], original['items'][0]['source_fingerprint'])
        self.assertEqual(row['sales_signal_evidence']['decision'], 'add_evidence_to_existing_action')

    def test_issue_holds_closed_move_and_withholds_proof(self):
        row = lead()
        row['partnershipMoveCloseout'] = {'outcome': 'issue_open', 'proof': {'url': 'https://example.com'}}
        result, = packet(row)['items']
        self.assertEqual(result['kind'], 'wait_for_sales_service_resolution')
        self.assertTrue(all(not s['proof_recorded'] for s in result['sales_signal_evidence']['signals']))
        self.assertNotIn('https://example.com', str(result))

    def test_lost_move_keeps_relation_without_outcome_claim(self):
        row, = packet(lead('lost'))['items']
        self.assertEqual(row['kind'], 'review_relationship_without_job_outcome_claim')

    def test_partner_opportunity_does_not_credit_a_customer_referral_early(self):
        row = lead('new')
        row.update(leadKind='partner_opportunity', primaryContactRole='partner', moveRelationships=[])
        self.assertEqual(packet(row)['items'], [])
        row['primaryContactRole'] = 'customer'
        self.assertTrue(packet(row)['items'][0]['sales_signal_evidence']['signals'][0]['actual_referral'])

    def test_unknown_contact_enters_research_and_old_stop_needs_reverification(self):
        row = lead('quoted')
        row['source'] = 'google'
        row['originAddress'] = 'Different stop'
        row['moveRelationships'][0].update(name='New Agent', connectedAddress='Previous stop')
        action, = build({'priority_review': []}, {'items': []}, {'items': []}, NOW, ([row], {}))['items']
        self.assertEqual(action['name'], 'New Agent')
        self.assertTrue(action['sales_signal_evidence']['signals'][0]['stop_needs_reverification'])
        self.assertEqual(action['kind'], 'verify_role_and_professional_route')
        self.assertNotIn('Previous stop', str(action))
