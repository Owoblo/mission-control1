import datetime as dt
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import urllib.error
import io
import base64
import threading
import urllib.request
from http.server import ThreadingHTTPServer

from scripts.research_hub.listings import Hub, parse_result, relationship, review_shared_phones, load_contacts
from scripts.research_hub.directory import Directory, context
from scripts.research_hub.contact_routes import ContactResearch, parse_routes
from scripts.research_hub.team_batch import extract as extract_team, refresh_captured_batch


class ResearchHubTest(unittest.TestCase):
    def test_listing_priorities_deduplicate_and_preserve_completed_work(self):
        directory = Directory(data={'records': {'a': [{'name': 'Jane', 'brokerage': 'Office'}]}})
        worker = ContactResearch(Path(self.tmp.name) / 'contacts', directory)
        row = {'listing_key': 'one', 'episode_match': 'same_mls_candidate',
               'existing_record_context': {'directory': {'state': 'existing_directory_candidate', 'identities': ['a']}},
               'relationship': {'suppressed': False}}
        receipt = worker.prioritize_listing_people([row, row, {**row, 'listing_key': 'two'}])
        self.assertEqual(receipt['pending_people_prioritized'], 1)
        self.assertEqual(len(receipt['people'][0]['listings']), 2)
        worker.db.execute("UPDATE tasks SET state='needs_review',result='{}'")
        worker.db.commit()
        worker.prioritize_listing_people([row])
        self.assertEqual(worker.db.execute('SELECT state FROM tasks').fetchone()[0], 'needs_review')
        self.assertEqual(worker.db.execute('SELECT count(*) FROM calls').fetchone()[0], 0)
        worker.db.close()

    def test_listing_priorities_do_not_expand_suppressed_or_ambiguous_people(self):
        directory = Directory(data={'records': {'a': [{'name': 'Jane', 'brokerage': 'Office'}]}})
        worker = ContactResearch(Path(self.tmp.name) / 'contacts', directory)
        row = {'listing_key': 'one', 'existing_record_context': {'directory':
               {'state': 'existing_directory_candidate', 'identities': ['a']}},
               'relationship': {'suppressed': True}}
        worker.prioritize_listing_people([row])
        worker.prioritize_listing_people([{**row, 'relationship': {}, 'superseded': True}])
        worker.prioritize_listing_people([{**row, 'relationship': {}, 'episode_match': 'different_listing_episode'}])
        self.assertEqual(worker.db.execute('SELECT count(*) FROM tasks').fetchone()[0], 0)
        worker.db.close()

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.hub = Hub(self.tmp.name)
        self.record = {'lane': 'residential', 'source': 'test', 'source_id': '123',
                       'address': '12 Main St', 'unit': '2', 'city': 'Windsor', 'source_observed_at': '2026-11-10', 'price': 100}

    def tearDown(self):
        self.hub.db.close()
        self.tmp.cleanup()

    def test_replay_freshness_and_actual_changes(self):
        self.assertTrue(self.hub.ingest(self.record))
        self.assertFalse(self.hub.ingest({**self.record, 'source_observed_at': '2026-11-11'}))
        self.assertTrue(self.hub.ingest({**self.record, 'price': 200}))
        self.assertEqual(self.hub.db.execute("SELECT count(*) FROM tasks WHERE state='pending'").fetchone()[0], 1)
        self.assertEqual(self.hub.db.execute('SELECT count(*) FROM events').fetchone()[0], 2)
        self.assertTrue(self.hub.ingest(self.record))  # Returning to a previous price is a new event.
        self.assertEqual(self.hub.db.execute("SELECT count(*) FROM tasks WHERE state='pending'").fetchone()[0], 1)

    def test_listing_episode_and_lanes_are_not_merged(self):
        self.hub.ingest(self.record)
        self.hub.ingest({**self.record, 'source_id': '124'})
        self.hub.ingest({**self.record, 'lane': 'rental'})
        self.assertEqual(self.hub.db.execute('SELECT count(*) FROM listings').fetchone()[0], 3)

    def test_unknown_scope_held(self):
        self.hub.ingest(self.record, False)
        self.assertEqual(self.hub.db.execute('SELECT state FROM tasks').fetchone()[0], 'scope_review')

    def test_periodic_recheck_once(self):
        self.hub.ingest(self.record)
        old = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=8)).isoformat()
        self.hub.db.execute("UPDATE tasks SET state='not_found',attempted=?", (old,))
        self.hub.db.commit()
        self.assertTrue(self.hub.ingest(self.record))
        self.assertFalse(self.hub.ingest(self.record))
        self.assertEqual(self.hub.db.execute('SELECT count(*) FROM tasks').fetchone()[0], 2)

    def test_error_holds_across_restart_no_repeat_spend(self):
        self.hub.ingest(self.record)
        error = urllib.error.HTTPError('https://api.openai.com', 429, 'hold', {}, io.BytesIO(b'{"error":{"code":"insufficient_quota"}}'))
        with patch.dict('os.environ', {'OPENAI_API_KEY': 'test'}), patch('urllib.request.urlopen', side_effect=error) as api:
            self.assertEqual(self.hub.research()['error_code'], 'insufficient_quota')
            self.assertEqual(self.hub.research()['state'], 'api_hold')
            self.assertEqual(api.call_count, 1)
        other = Hub(self.tmp.name)
        try:
            with patch('urllib.request.urlopen') as api:
                other.research()
                api.assert_not_called()
        finally:
            other.db.close()

    def test_search_candidates_never_become_verified(self):
        rep = {'name': 'Jane Agent', 'role': 'listing_agent', 'source_url': 'https://example.org/property',
               'address_evidence': '12 Main St', 'role_evidence': 'Listed by Jane Agent', 'phone': '5195551234'}
        response = {'status': 'completed', 'output': [{'action': {'sources': [{'url': rep['source_url']}]},
                    'content': [{'type': 'output_text', 'text': json.dumps({'representatives': [rep, {**rep, 'source_url': 'https://invented.invalid'}]})}]}]}
        result = parse_result(response)
        self.assertEqual(len(result['representatives']), 1)
        self.assertIsNone(result['representatives'][0]['phone'])
        self.assertEqual(result['representatives'][0]['temporal_scope'], 'unknown')
        response['status'] = 'incomplete'
        with self.assertRaises(ValueError):
            parse_result(response)

    def test_shared_office_phone_and_suppression(self):
        contacts = [{'id': 'a', 'name': 'Jane Agent', 'phone': '5195551234', 'company': 'Office', 'do_not_contact': True}]
        rep = {'name': 'Jane Agent', 'phone': '5195551234', 'phone_kind': 'office'}
        self.assertEqual(relationship(rep, contacts)['state'], 'ambiguous')
        matched = relationship({**rep, 'brokerage': 'Office'}, contacts)
        self.assertTrue(matched['suppressed'])
        self.assertFalse(matched['outreach_eligible'])
        self.assertEqual(relationship({**rep, 'name': 'Someone Else'}, contacts)['state'], 'no_match_in_snapshot')

    def test_same_number_on_two_agents_is_not_personal(self):
        result = review_shared_phones([{'name': 'Jane', 'phone': '(519) 555-1234', 'phone_kind': 'direct'},
                                       {'name': 'John', 'phone': '+1 519 555 1234', 'phone_kind': 'office'}])
        self.assertEqual(result[0]['phone_kind'], 'unknown')
        self.assertEqual(result[1]['phone_kind'], 'office')

    def test_transient_crm_read_failure_retries_without_partial_snapshot(self):
        error = urllib.error.HTTPError('https://example.org', 503, 'unavailable', {}, None)
        with patch('scripts.research_hub.listings.rest', side_effect=[error, [{'id': '1'}]]) as get, patch('time.sleep'):
            self.assertEqual(load_contacts({}), [{'id': '1'}])
            self.assertEqual(get.call_count, 2)

    def test_known_directory_realtor_is_not_new_despite_no_crm_match(self):
        directory = Directory(data={'records': {'realtor.ca:123': [{'name': 'Jane Agent', 'brokerage': 'Office',
                                                                  'email': 'jane@example.org', 'phone': '519-555-1234'}]}})
        rep = {'name': 'JANE AGENT', 'brokerage': 'Office', 'email': 'Jane@example.org', 'phone': '+1 (519) 555-1234'}
        result = context(rep, {'state': 'no_match_in_snapshot'}, directory)
        self.assertEqual(result['category'], 'existing_directory_candidate')
        self.assertEqual(result['possible_contact_additions'], {})
        self.assertFalse(result['directory']['routes_are_current_verified'])

    def test_name_only_directory_match_requires_identity_review(self):
        directory = Directory(data={'records': {'a': [{'name': 'Jane', 'brokerage': 'Other Office'}]}})
        self.assertEqual(directory.match({'name': 'Jane', 'brokerage': 'New Office'})['state'], 'identity_review')

    def test_earlier_website_candidates_are_not_counted_as_new(self):
        directory=Directory(data={'records':{'a':[{'name':'Jane','brokerage':'Office','website_phones':'(519) 555-1234|519-555-1235','website_emails':'jane@realbroker.ca|team@realbroker.ca'}]}})
        result=context({'name':'Jane','brokerage':'Office','phone':'+15195551234','email':'jane@realbroker.ca'},
                       {'state':'no_match_in_snapshot'},directory)
        self.assertEqual(result['possible_contact_additions'],{})

    def test_relisting_does_not_link_other_episode(self):
        rep = {'name': 'Jane', 'role': 'listing_agent', 'source_url': 'https://example.org/listing',
               'address_evidence': '12 Main St', 'role_evidence': 'Listed by Jane', 'source_mls': 'NEW123'}
        data = {'status': 'completed', 'output': [{'action': {'sources': [{'url': rep['source_url']}]},
                'content': [{'type': 'output_text', 'text': json.dumps({'representatives': [rep]})}]}]}
        result = parse_result(data, {'listing_id': 'OLD456'})['representatives'][0]
        self.assertEqual(result['episode_match'], 'different_listing_episode')
        self.assertFalse(result['episode_link_verified'])

    def test_removed_listing_keeps_historical_people(self):
        self.hub.ingest(self.record)
        result = {'representatives': [{'name': 'Jane', 'phone': None, 'temporal_scope': 'historical'}]}
        self.hub.db.execute("UPDATE tasks SET state='needs_review',result=?", (json.dumps(result),));self.hub.db.commit()
        self.hub.ingest({**self.record, 'source_status': 'unavailable', 'source_url': None})
        self.hub.export([])
        rows = json.loads((Path(self.tmp.name) / 'relationship-candidates.json').read_text())
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['name'], 'Jane')
        self.assertTrue(rows[0]['superseded'])
        self.assertEqual(rows[0]['current_availability'], 'not_confirmed')

    def test_directory_wide_shared_phone_and_new_route_gate(self):
        directory = Directory(data={'records': {
            'a': [{'name':'Jane','brokerage':'Office','phone':'5195551234'}],
            'b': [{'name':'John','brokerage':'Office','phone':'+1 519 555 1234'}]}})
        self.assertTrue(directory.route_inventory('a')['needs_number_research'])
        routes=[{'kind':'phone','value':'5195551234','ownership':'direct_professional',
                 'source_url':'https://example.org','identity_quote':'Jane','route_quote':'Call Jane'},
                {'kind':'email','value':'info@example.org','ownership':'direct_professional',
                 'source_url':'https://example.org','identity_quote':'Jane','route_quote':'Email'}]
        response={'status':'completed','output':[{'action':{'sources':[{'url':'https://example.org'}]},
                  'content':[{'type':'output_text','text':json.dumps({'routes':routes})}]}]}
        parsed=parse_routes(response,'a',directory)['routes']
        self.assertTrue(parsed[0]['already_saved_for_agent'])
        self.assertTrue(parsed[0]['shared_in_saved_directory'])
        self.assertEqual(parsed[0]['ownership_candidate'],'unknown')
        self.assertEqual(parsed[1]['ownership_candidate'],'unknown')

    def test_contact_queue_seeding_is_idempotent_and_read_only(self):
        directory=Directory(data={'records':{'a':[{'name':'Jane','brokerage':'Office','phone':None}]}})
        worker=ContactResearch(Path(self.tmp.name)/'contacts',directory)
        try:
            worker.seed(['a']);worker.seed(['a'])
            self.assertEqual(worker.export()['tasks'],{'pending':1})
            self.assertEqual(worker.export()['production_writes'],0)
        finally:worker.db.close()

    def test_empty_first_pass_gets_one_bounded_deeper_pass(self):
        self.hub.ingest(self.record)
        payload={'status':'completed','output':[{'content':[{'type':'output_text','text':json.dumps({'representatives':[], 'gaps':['Original page unavailable']})}]}]}
        def response(*args,**kwargs):
            from unittest.mock import MagicMock
            context=MagicMock();context.__enter__.return_value=io.BytesIO(json.dumps(payload).encode());return context
        with patch.dict('os.environ',{'OPENAI_API_KEY':'test'}),patch('urllib.request.urlopen',side_effect=response) as api:
            self.hub.research()
            self.assertEqual(self.hub.db.execute('SELECT state FROM tasks').fetchone()[0],'needs_deeper_research')
            self.hub.research()
            body=json.loads(api.call_args.args[0].data)
            self.assertEqual(body['max_tool_calls'],6)
            self.assertIn('recovery_strategy',json.loads(body['input']))
            self.assertEqual(self.hub.db.execute('SELECT state FROM tasks').fetchone()[0],'not_found')
            self.assertEqual(self.hub.research()['state'],'queue_idle')

    def test_batch_parser_requires_person_employer_edge(self):
        directory=Directory(data={'records':{'a':[{'name':'Jane','brokerage':'Office','phone':None}]}})
        graph={'@graph':[{'@id':'office','@type':'Organization','name':'Office, Brokerage'},
                         {'@type':'Person','name':'Jane','jobTitle':'Broker','description':'519-555-1234 jane@realbroker.ca','worksFor':{'@id':'office'}},
                         {'@type':'Person','name':'Unrelated','jobTitle':'Broker','description':'519-555-8888 other@realbroker.ca'}]}
        body=('<script type="application/ld+json">'+json.dumps(graph)+'</script>').encode()
        result=extract_team(body,'https://realbroker.ca/team','2026-11-11','Office',directory)
        self.assertEqual(result['summary']['people_with_routes'],1)
        self.assertEqual(result['summary']['new_phone_candidates'],1)
        self.assertEqual(result['summary']['new_email_candidates'],1)
        self.assertTrue(all(not r['ownership_verified'] and not r['outreach_eligible'] for r in result['candidates']))

    def test_failed_team_refresh_keeps_previous_capture(self):
        folder=Path(self.tmp.name)/'batch';folder.mkdir()
        previous={'summary':{'captured_at':'2000-01-01'},'candidates':[{'name':'Jane'}]}
        (folder/'batch.json').write_text(json.dumps(previous))
        with patch('urllib.request.build_opener') as opener:
            opener.return_value.open.side_effect=TimeoutError
            result=refresh_captured_batch(folder)
        self.assertEqual(result['state'],'source_error_prior_evidence_retained')
        self.assertEqual(json.loads((folder/'batch.json').read_text()),previous)

    def test_failed_intake_preserves_checkpoint_and_inventory(self):
        self.hub.ingest(self.record)
        with patch('scripts.research_hub.listings.rest', side_effect=TimeoutError):
            report = self.hub.intake({}, {'regions': [{'cities': ['Windsor']}]})
        self.assertEqual(report['rental']['state'], 'read_error')
        self.assertEqual(report['residential']['cities_this_cycle']['Windsor']['state'], 'read_error')
        self.assertEqual(self.hub.db.execute('SELECT count(*) FROM listings').fetchone()[0], 1)
        self.assertIsNone(self.hub.get('scan:residential'))

    def test_export_does_not_advance_observation_or_certify_current(self):
        self.hub.ingest({**self.record, 'source_observed_at': '2000-01-01'})
        report = self.hub.export()
        self.assertEqual(report['source_freshness']['residential']['older_than_14_days'], 1)
        self.assertEqual(report['candidate_connections'], 0)

    def test_new_dashboard_routes_require_existing_auth(self):
        from scripts.market_map.cloud import railway_entry
        with patch.object(railway_entry, 'ROOT', Path(self.tmp.name)), patch.dict('os.environ', {'DASHBOARD_PASSWORD': 'test'}):
            server = ThreadingHTTPServer(('127.0.0.1', 0), railway_entry.Handler)
            thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
            try:
                url = 'http://127.0.0.1:' + str(server.server_port) + '/research/status'
                with self.assertRaises(urllib.error.HTTPError) as error:
                    urllib.request.urlopen(url)
                self.assertEqual(error.exception.code, 401)
                header = 'Basic ' + base64.b64encode(b'john:test').decode()
                with urllib.request.urlopen(urllib.request.Request(url, headers={'Authorization': header})) as response:
                    data = json.load(response)
                self.assertEqual(len(data['lanes']), 5)
            finally:
                server.shutdown(); server.server_close(); thread.join()


if __name__ == '__main__':
    unittest.main()
