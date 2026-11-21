import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from scripts.market_map import muse_open_house_import as muse
from scripts.market_map import scaled_daily_preparation as daily


class BackfillTest(unittest.TestCase):
    def test_completed_research_retains_full_history_tasks_and_release_holds(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            review = root/'muse-imports'/'reviews'/('a'*64)
            results = review/'source-first'
            results.mkdir(parents=True)
            (results/'status.json').write_text('{"state":"source_first_pass_complete"}')
            (results/'agent-results.json').write_text(json.dumps({'items': [
                {'id': 'existing-agent', 'name': 'Existing Agent', 'crm_matches': ['contact-1']},
                {'id': 'new-agent', 'name': 'New Agent', 'crm_matches': [], 'state': 'new_relationship_source_review'},
            ]}))
            (review/'open-house-review.json').write_text('{"items":[]}')
            encounter = {'id': 'touch-1', 'contact_id': 'contact-1', 'direction': 'outbound',
                         'created_at': '2024-01-01T00:00:00Z', 'notes': 'I will drop off the cards.'}
            task = {'id': 'task-1', 'related_id': 'contact-1', 'title': 'Drop off cards', 'status': 'open'}
            contact = dict.fromkeys(['do_not_contact','cross_channel_suppressed_at','email_unsubscribed_at',
                                     'email_last_bounced_at','stage','decision'])
            contact.update(id='contact-1', sequence_paused=True, sequence_paused_reason='unfulfilled_visit')
            tables = {'market_contacts': [contact], 'market_touches': [encounter],
                      'crm_tasks': [task], 'sequence_jobs': []}
            with patch.object(daily, 'OUT', root), patch.object(daily, 'ROOT', root), \
                 patch.object(daily, 'database_rows', side_effect=lambda _, table, *a, **kw: tables[table]) as snapshot:
                daily.reconcile_completed_muse_research()
                output = json.loads((review/'relationship-decisions.json').read_text())
                daily.reconcile_completed_muse_research()
                self.assertEqual(snapshot.call_count, 4)
            self.assertEqual(output['contacts'][0]['history'], [encounter])
            self.assertEqual(output['contacts'][0]['open_tasks'], [task])
            self.assertIn('unfulfilled_visit', output['contacts'][0]['holds'])
            self.assertIn('recipient_specific_release_basis_unconfirmed', output['new_or_ambiguous_agents'][0]['holds'])
            self.assertFalse(output['dispatch'])

    def test_new_evening_packet_gets_review_despite_morning_report(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            morning = root/'days/2026-11-19'
            morning.mkdir(parents=True)
            (morning/'report.json').write_text('{}')
            intake = root/'muse-open-house-intake.json'
            unresolved = [{'session_id': 'missing-agent', 'reason': 'professional_agent_research'}]
            event = {'session_id': 'missing-agent', 'mls': 'X1234567',
                     'property_key': 'toronto|12mainstreet|', 'city': 'Toronto'}
            with patch.object(daily, 'OUT', root), patch.object(daily, 'ROOT', root), \
                 patch.object(daily, 'crm_screen_snapshot', return_value=([], [], set())) as snapshot, \
                 patch.object(daily, 'database_rows', return_value=[]):
                for digest in ('9'*64, 'a'*64):
                    intake.write_text(json.dumps({'summary': {'archive_sha256': digest},
                                                  'items': [], 'unresolved_sessions': unresolved,
                                                  'upcoming_sessions': [event]}))
                    for _ in range(2):
                        daily.review_latest_muse_export({'state': 'storage_export_imported'})
                    report = json.loads((root/'muse-imports'/'reviews'/digest/'open-house-review.json').read_text())
                    self.assertEqual(report['muse_intake']['archive_sha256'], digest)
                    self.assertEqual(report['unresolved_sessions'], [{**event, **unresolved[0]}])
                    self.assertFalse(report['dispatch'])
                    queue = json.loads((root/'muse-imports'/'reviews'/digest/'research-queue.json').read_text())
                    self.assertEqual(queue['unresolved_listings'][0]['mls'], event['mls'])
                    self.assertEqual(queue['relationship_review'], 'open-house-review.json')
                    self.assertFalse(queue['dispatch'])
                self.assertEqual(snapshot.call_count, 2)
                self.assertTrue((morning/'report.json').is_file())

    def test_old_page_recent_update_is_archived_once_and_never_regresses_latest(self):
        old = '2026-11-01T00:00:00+00:00'
        changed = '2026-11-19T00:00:00+00:00'
        objects = [dict(name=f'{i}.zip', id=str(i), updated_at=old) for i in range(30)]
        objects.append(dict(name='late.zip', id='late', updated_at=changed))
        offsets, fetches = [], []
        def network(request, timeout):
            if '/list/' in request.full_url:
                q = json.loads(request.data)
                offsets.append(q['offset'])
                return io.BytesIO(json.dumps(objects[q['offset']:q['offset']+30]).encode())
            fetches.append(request.full_url)
            return io.BytesIO(b'archive')
        with tempfile.TemporaryDirectory() as directory, patch.object(muse,'urlopen',network), patch.object(muse,'compile_export',return_value={'summary':{'published_at':old}}):
            root = Path(directory)
            current = root/'muse-open-house-intake.json'
            current.write_text(json.dumps({'summary':{'published_at':changed}}))
            for _ in range(2):
                report=muse.pull_storage_export(root,{'SUPABASE_URL':'https://fixture.invalid','SUPABASE_KEY':'fixture'},since_timestamp=changed)
                self.assertEqual(report['state'],'no_new_valid_export')
            self.assertEqual(offsets,[0,30,0,30])
            self.assertEqual(len(fetches),1)
            self.assertEqual(len(list((root/'muse-imports/versions').glob('*.json'))),1)
            self.assertEqual(json.loads(current.read_text())['summary']['published_at'],changed)
