from datetime import datetime, timezone
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from . import partnership_relationship_backlog as backlog
from . import partnership_run_notifications as reports

CID = '313cfbb5-214e-415a-9aa8-5904b686778e'
CONTACT = {'id': CID, 'name': 'Test Partner', 'city': 'Brampton'}
BEFORE = '2026-06-01T08:00:00+00:00'
LATER = '2026-07-01T14:00:00+00:00'
NOW = '2026-11-23T13:00:00+00:00'


def touch(id, notes, *, channel='sms', direction='inbound', created_at=BEFORE):
    return {'id': id, 'contact_id': CID, 'direction': direction, 'notes': notes,
            'channel': channel, 'created_at': created_at}


class RelationshipBacklogTests(unittest.TestCase):
    def test_sales_closure_does_not_bypass_recent_context_or_ownership(self):
        history = [touch('sms', 'Thanks for replying.')]
        closed = {'contact_id': CID, 'stage': 'lost', 'lost_reason': 'Price', 'updated_at': LATER}
        result = backlog.project([CONTACT], history, [], [closed], [], {}, BEFORE, NOW)
        self.assertEqual([row['state'] for row in result], ['Closed Sales outcome'])
        self.assertIn('45-day rule', result[0]['reasons'])
        self.assertEqual(backlog.project([CONTACT], history, [], [closed, {**closed, 'stage': 'quoted'}], [], {}, BEFORE, NOW), [])

    def test_recorded_meeting_outcome_closes_matching_case_and_no_show_remains(self):
        history = [touch('a', 'Can we meet in person?'), touch('b', 'Thanks for reaching out', direction='outbound', created_at=LATER)]
        task = {'related_id': CID, 'title': 'Meeting follow-through', 'status': 'completed',
                'outcome_note': 'Met and agreed no further action', 'completed_at': LATER}
        self.assertEqual(backlog.project([CONTACT], history, [task], [], [], {}, BEFORE, NOW), [])
        rows = backlog.project([CONTACT], history, [task], [], [], {
            CID: [{'scheduled_at': BEFORE, 'status': 'no_show'}]}, BEFORE, NOW)
        self.assertIn('Marked no-show', rows[0]['reasons'])

    def test_intro_alone_does_not_create_meeting_and_call_recovery_takes_precedence(self):
        history = [touch('a', 'Would it be okay if I stopped by your office to drop off a few cards?', direction='outbound')]
        self.assertEqual(backlog.project([CONTACT], history, [], [], [], {}, BEFORE, NOW), [])
        job = {'contact_id': CID, 'job_status': 'completed', 'job_id': 'job-1', 'updated_at': LATER}
        rows = backlog.project([CONTACT], history, [], [], [job], {}, BEFORE, NOW)
        self.assertEqual([row['state'] for row in rows], ['Completed referral'])
        history.append(touch('b', 'Additional charges discussed. name@example.com.\nTranscript: Please meet in person.', channel='phone'))
        rows = backlog.project([CONTACT], history, [], [], [job], {}, BEFORE, NOW)
        self.assertEqual([row['state'] for row in rows], ['Service recovery'])
        self.assertNotIn('@example.com', rows[0]['reasons'])

    def test_notification_caches_scan_and_respects_existing_receipt(self):
        with TemporaryDirectory() as root:
            out = Path(root)
            state = out/'receipts'
            state.mkdir()
            now = datetime.fromisoformat(NOW).astimezone(timezone.utc)
            result = {'cutoff': BEFORE[:10], 'threads_reviewed': 1, 'touches_reviewed': 1, 'review': [], 'counts': {}}
            with patch.object(backlog, 'scan', return_value=result) as scan:
                complete, parts = reports.relationship_backlog_notices(out, state, now, None)
                self.assertEqual(parts[0]['lane'], 'Scheduler')
                reports.relationship_backlog_notices(out, state, now, None)
                scan.assert_called_once()
                reports.save(complete, {'parts': 1})
                self.assertIsNone(reports.relationship_backlog_notices(out, state, now, None))
