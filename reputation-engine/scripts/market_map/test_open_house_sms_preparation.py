from datetime import datetime, timezone
import unittest

from .scaled_daily_preparation import open_house_sms_candidates


class OpenHouseSmsPreparationTests(unittest.TestCase):
    def test_existing_recovered_mobile_remains_in_carrier_inventory_when_held(self):
        route = {'kind':'phone','value':'+14165550123','source_url':'https://agent.test/','proof':'Taylor Example direct',
                 'shared_in_research_batch':False}
        agent = {'id':'taylorexample','name':'Taylor Example','brokerages':['Example Realty'],
                 'crm_matches':['crm-1'],'candidate_directory_identities':1,'routes':[route]}
        contact = {'name':'Taylor Example','city':'Toronto','company':'Example Realty','phone':'+14165550124'}
        decision = {'contact_id':'crm-1','contact':contact,'state':'held','holds':['inbound_thread_review']}
        [entry] = open_house_sms_candidates([agent],[decision],{})
        self.assertEqual(entry['verified_routes'],[route])
        self.assertIn('inbound_thread_review',entry['review_holds'])
        self.assertIn('agent_phone_requires_identity_review',entry['review_holds'])
        self.assertNotIn('prior_sms_touch_id',entry)

    def test_quiet_history_uses_same_historical_destination_with_current_event(self):
        event = {'mls':'C1234567','city':'Toronto','start_iso':'2026-11-22T18:00:00Z',
                 'source_url':'https://example.test/listing','status':'upcoming',
                 'verified_at':'2026-11-21','verified_on_export_day':True}
        role = {'mls':event['mls'],'source_url':event['source_url'],'proof':'Exact listing and agent name','events':[event]}
        agent = {'id':'taylorexample','name':'Taylor Example','brokerages':['Example Realty Brokerage'],
                 'crm_matches':['crm-1'],'candidate_directory_identities':0,'roles':[role]}
        contact = {'name':'Taylor Example','city':'Toronto','company':'Example Realty','phone':'+14165550124',
                   'notes':'profile=https://directory.test/agent/123'}
        touch = {'id':'touch-1','channel':'sms','direction':'outbound','metadata':{'to':contact['phone']}}
        decision = {'contact_id':'crm-1','contact':contact,'state':'quiet_sms_route_and_sender_review','history':[touch]}
        clock = datetime(2026,11,21,16,tzinfo=timezone.utc)
        [entry] = open_house_sms_candidates([agent],[decision],{},clock=clock)
        self.assertEqual(entry['verified_routes'][0]['origin'],'crm_delivered_sms_route')
        self.assertEqual(entry['prior_sms_touch_id'],'touch-1')
        self.assertEqual(entry['brokerages'],[contact['company']])
        self.assertEqual(entry['review_holds'],[])
        self.assertEqual(open_house_sms_candidates([agent],[{**decision,'state':'held'}],{},clock=clock),[])
