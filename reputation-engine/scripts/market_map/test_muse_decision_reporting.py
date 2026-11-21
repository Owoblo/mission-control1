from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from . import scaled_daily_preparation as worker


class MuseDecisionReportingTests(unittest.TestCase):
    def test_existing_review_is_summarized_once_without_reopening_decisions(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            review = root / 'muse-imports' / 'reviews' / 'archive'
            results = review / 'source-first'
            results.mkdir(parents=True)
            worker.save(results / 'agent-results.json', {})
            path = review / 'relationship-decisions.json'
            prior = {
                'decision_version': 2,
                'dispatch': False,
                'contacts': [
                    {'state': 'held', 'holds': ['recent', 'recent', 'open_task'], 'history': ['private']},
                    {'state': 'quiet_sms_route_and_sender_review', 'holds': []},
                ],
                'new_or_ambiguous_agents': [
                    {'state': 'brokerage_identity_review', 'holds': ['release_basis']},
                ],
            }
            worker.save(path, prior)
            with patch.object(worker, 'OUT', root), patch.object(worker, 'database_rows') as database:
                worker.reconcile_completed_muse_research()
                updated = worker.read(path)
                self.assertEqual(updated.pop('review_summary'), {
                    'crm_contacts_by_state': {'held': 1, 'quiet_sms_route_and_sender_review': 1},
                    'crm_contacts_by_hold': {'open_task': 1, 'recent': 1},
                    'new_or_ambiguous_agents_by_state': {'brokerage_identity_review': 1},
                    'new_or_ambiguous_agents_by_hold': {'release_basis': 1},
                })
                self.assertEqual(updated, prior)
                with patch.object(worker, 'save') as save:
                    worker.reconcile_completed_muse_research()
                    save.assert_not_called()
                database.assert_not_called()

    def test_new_export_writes_summary_with_the_first_decision(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            review = root / 'muse-imports' / 'reviews' / 'new-archive'
            results = review / 'source-first'
            results.mkdir(parents=True)
            worker.save(results / 'agent-results.json', {
                'items': [{'id': 'agent', 'name': 'Agent', 'state': 'professional_route_missing'}],
            })
            worker.save(results / 'status.json', {'state': 'source_first_pass_complete'})
            worker.save(review / 'open-house-review.json', {'items': []})
            with patch.object(worker, 'OUT', root), patch.object(worker, 'ROOT', root):
                worker.reconcile_completed_muse_research()
            decision = worker.read(review / 'relationship-decisions.json')
            self.assertFalse(decision['dispatch'])
            self.assertEqual(decision['review_summary'], {
                'crm_contacts_by_state': {},
                'crm_contacts_by_hold': {},
                'new_or_ambiguous_agents_by_state': {'professional_route_missing': 1},
                'new_or_ambiguous_agents_by_hold': {'recipient_specific_release_basis_unconfirmed': 1},
            })
