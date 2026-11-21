import json
from pathlib import Path
import tempfile
import unittest
import urllib.error

from scripts.market_map.site_research_ai import SiteResearchAI


SITE={'site_id':'site:one','addresses':'["42 Main St"]','municipality':'Windsor','district':'City Centre'}
SOURCE={'url':'https://example.org/shop','text':'Example Shop operates at 42 Main St in Windsor, serving the area.',
        'body_sha256':'a'*64,'retrieved_at':'2026-10-30T12:00:00Z'}
CLAIM={'organization':'Example Shop','entity_kind':'organization','address':'42 Main St','unit':'','relationship':'tenant',
       'temporal_status':'reported_current','source_url':SOURCE['url'],'exact_quote':SOURCE['text']}


def response(value, output=None):
    return {'id':'resp_test','status':'completed','usage':{'input_tokens':100,'output_tokens':50},
            'output':(output or [])+[{'type':'message','content':[{'type':'output_text','text':json.dumps(value)}]}]}


class AIResearchTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name);(self.root/'docs').mkdir()
        (self.root/'docs/source-first-current-contract.md').write_text('Map occupants with evidence. Preserve unknowns.')

    def client(self,call,**kwargs):
        return SiteResearchAI(self.root,self.root/'run',call=call,sleep=lambda n:None,**kwargs)

    def test_discovery_rejects_unobserved_urls_and_checkpoints(self):
        calls=[]
        def call(body):
            calls.append(body)
            return response({'sources':[{'url':SOURCE['url'],'purpose':'Official page'},
                 {'url':'https://invented.invalid','purpose':'unsupported'}],
                 'proposals':[{'organization':'Example Shop','address':'42 Main St','source_url':SOURCE['url']}], 'gaps':[]},
                 [{'type':'web_search_call','action':{'type':'search','sources':[{'url':SOURCE['url']}]}}])
        ai=self.client(call);result=ai.discover(SITE)
        self.assertEqual(result['urls'],[SOURCE['url']]);self.assertEqual(len(result['rejected_unobserved_urls']),1)
        self.assertFalse(result['occupancy_verified'])
        self.assertEqual(calls[0]['tools'],[{'type':'web_search'}]);self.assertEqual(calls[0]['max_tool_calls'],5)
        self.assertEqual(self.client(lambda _:self.fail('paid replay')).discover(SITE),result)
        self.assertEqual(len(calls),1)

    def test_simple_extraction_does_not_call_expensive_review(self):
        calls=[]
        def call(body):
            calls.append(body);return response({'claims':[CLAIM],'gaps':['Tenant coverage unknown'],'needs_review':False})
        ai=self.client(call);result=ai.analyze(SITE,[SOURCE])
        self.assertEqual(len(calls),1);self.assertEqual(calls[0]['model'],'gpt-6-luna')
        self.assertEqual(len(result['claims']),1);self.assertFalse(result['escalated'])
        self.assertFalse(result['occupancy_verified']);self.assertFalse(result['tenant_coverage_complete'])
        self.assertNotIn('tools',calls[0]);self.assertEqual(ai.usage_summary()['http_attempts'],1)

    def test_invalid_quote_escalates_and_stays_held(self):
        calls=[]
        def call(body):
            calls.append(body);return response({'claims':[dict(CLAIM,exact_quote='Fabricated quote naming Example Shop here')],
                'gaps':[],'needs_review':False})
        result=self.client(call).analyze(SITE,[SOURCE])
        self.assertEqual([c['model'] for c in calls],['gpt-6-luna','gpt-5.4'])
        self.assertEqual(result['claims'],[]);self.assertTrue(result['requires_review'])
        self.assertIn('quote_not_in_captured_source',result['held_claims'][0]['hold_reasons'])

    def test_no_sources_do_not_spend_or_infer_vacancy(self):
        result=self.client(lambda _:self.fail('unexpected API call')).analyze(SITE,[])
        self.assertTrue(result['requires_review']);self.assertFalse(result['occupancy_verified'])

    def test_retry_429_bounded_and_recorded(self):
        calls=[]
        def call(body):
            calls.append(body)
            if len(calls)<3:raise urllib.error.HTTPError('https://api.openai.com',429,'Rate limited',{},None)
            return response({'claims':[CLAIM],'gaps':[],'needs_review':False})
        ai=self.client(call);self.assertEqual(len(ai.analyze(SITE,[SOURCE])['claims']),1)
        self.assertEqual(ai.usage_summary()['http_attempts'],3)

    def test_timeout_is_not_blindly_retried_after_restart(self):
        def call(body):raise TimeoutError('uncertain charge')
        with self.assertRaises(TimeoutError):self.client(call).analyze(SITE,[SOURCE])
        with self.assertRaisesRegex(RuntimeError,'Uncertain prior'):
            self.client(lambda _:self.fail('unexpected duplicate')).analyze(SITE,[SOURCE])

    def test_address_mismatch_never_admitted(self):
        def call(body):return response({'claims':[dict(CLAIM,address='44 Main St')],'gaps':[],'needs_review':False})
        result=self.client(call).analyze(SITE,[SOURCE])
        self.assertEqual(result['claims'],[])
        self.assertIn('address_requires_reconciliation',result['held_claims'][0]['hold_reasons'])

    def test_bad_provenance_fails_before_api(self):
        ai=self.client(lambda _:self.fail('unexpected API call'))
        with self.assertRaisesRegex(ValueError,'provenance'):ai.analyze(SITE,[dict(SOURCE,retrieved_at='')])

    def test_large_source_uses_explicit_windows_and_keeps_matching_evidence(self):
        calls=[]
        def call(body):
            calls.append(body);return response({'claims':[CLAIM],'gaps':[],'needs_review':False})
        site=dict(SITE,reported_place_names=['Example Shop'],building_ids=['building:one'],
                  zoning_codes=['CD2.1'],coordinates={'latitude':42.3,'longitude':-83.0})
        source=dict(SOURCE,text='x'*100000+SOURCE['text']+'y'*100000)
        result=self.client(call).analyze(site,[source])
        packet=json.loads(calls[0]['input'][1]['content'])
        self.assertIn(SOURCE['text'],packet['captured_sources'][0]['text'])
        self.assertGreater(packet['captured_sources'][0]['text_selection']['omitted_characters'],190000)
        self.assertEqual(packet['site']['reported_place_names'],['Example Shop'])
        self.assertEqual(packet['site']['zoning_codes'],['CD2.1'])
        self.assertEqual(len(result['claims']),1)
        self.assertTrue(any('omitted' in gap for gap in result['gaps']))

    def test_schema_failure_uses_one_fallback(self):
        calls=[]
        def call(body):
            calls.append(body)
            return response({'wrong':'shape'} if len(calls)==1 else {'claims':[CLAIM],'gaps':[],'needs_review':False})
        result=self.client(call).analyze(SITE,[SOURCE]);self.assertTrue(result['escalated'])
        self.assertEqual(len(calls),2);self.assertEqual(len(result['claims']),1)

    def test_organization_quote_without_address_is_held(self):
        source=dict(SOURCE,text='Example Shop serves the area with excellent goods. Address elsewhere: 42 Main St.')
        def call(body):return response({'claims':[dict(CLAIM,exact_quote='Example Shop serves the area with excellent goods.')],
                                       'gaps':[],'needs_review':False})
        result=self.client(call).analyze(SITE,[source])
        self.assertEqual(result['claims'],[])
        self.assertIn('address_association_not_literal_in_quote',result['held_claims'][0]['hold_reasons'])

    def test_suffix_aliases_match_but_house_numbers_do_not(self):
        calls=[]
        text='Example Shop operates at 42 Main Street in Windsor, serving the area.'
        def call(body):return response({'claims':[dict(CLAIM,exact_quote=text)],'gaps':[],'needs_review':False})
        result=self.client(call).analyze(SITE,[dict(SOURCE,text=text)])
        self.assertEqual(len(result['claims']),1)
        # 42 must not match 142 inside a literal quote.
        ai=SiteResearchAI(self.root,self.root/'other',call=lambda body:response({
            'claims':[dict(CLAIM,exact_quote=text.replace('42','142'))],'gaps':[],'needs_review':False}))
        result=ai.analyze(SITE,[dict(SOURCE,text=text.replace('42','142'))])
        self.assertEqual(result['claims'],[])

    def test_failed_fallback_preserves_primary_evidence(self):
        calls=[]
        def call(body):
            calls.append(body)
            if len(calls)>1:raise TimeoutError('network uncertain')
            return response({'claims':[CLAIM],'gaps':['Other tenants unknown'],'needs_review':True})
        result=self.client(call).analyze(SITE,[SOURCE])
        self.assertEqual(len(result['claims']),1);self.assertTrue(result['requires_review'])
        self.assertTrue(any('Fallback unavailable' in gap for gap in result['gaps']))

    def test_full_postal_suffix_reconciles_street_quote(self):
        text='Example Shop contact: 42 Main Street Windsor Ontario Canada N8X 4L4.'
        def call(body):return response({'claims':[dict(CLAIM,address='42 Main St, Windsor, Ontario, Canada N8X 4L4',
            exact_quote=text,relationship='located_at')],'gaps':[],'needs_review':False})
        result=self.client(call).analyze(SITE,[dict(SOURCE,text=text)])
        self.assertEqual(len(result['claims']),1);self.assertFalse(result['escalated'])
        self.assertEqual(result['claims'][0]['matched_street_address'],'42 main street')
        self.assertEqual(result['claims'][0]['address'],'42 Main St, Windsor, Ontario, Canada N8X 4L4')

    def test_city_postal_can_follow_unit_in_quote_without_losing_unit(self):
        text='Example Shop: 42 Main St, Suite 200 Windsor, ON N8W 5R7.'
        def call(body):return response({'claims':[dict(CLAIM,address='42 Main St, Windsor, ON N8W 5R7',
            unit='Suite 200',exact_quote=text,relationship='located_at')],'gaps':[],'needs_review':False})
        result=self.client(call).analyze(SITE,[dict(SOURCE,text=text)])
        self.assertEqual(len(result['claims']),1);self.assertEqual(result['claims'][0]['unit'],'Suite 200')

    def test_unit_in_full_claim_requires_matching_separate_unit(self):
        text='Example Shop: 42 Main St Suite 200 Windsor, ON N8W 5R7.'
        ai=self.client(lambda _:self.fail('gate-only test'))
        context=dict(SITE,addresses=['42 Main St'])
        claim=dict(CLAIM,address='42 Main St Suite 200, Windsor, ON N8W 5R7',unit='200',exact_quote=text)
        accepted,held=ai._gate({'claims':[claim]},context,[dict(SOURCE,text=text)])
        self.assertEqual(len(accepted),1)
        accepted,held=ai._gate({'claims':[dict(claim,unit='201')]},context,[dict(SOURCE,text=text)])
        self.assertEqual(accepted,[])
        accepted,held=ai._gate({'claims':[dict(claim,unit='')]},context,[dict(SOURCE,text=text)])
        self.assertEqual(accepted,[])

    def test_wrong_city_direction_number_and_country_stay_held(self):
        ai=self.client(lambda _:self.fail('gate-only test'))
        context=dict(SITE,addresses=['42 Main St E'])
        for address in ('42 Main St W, Windsor, ON','142 Main St E, Windsor, ON',
                        '42 Main St E, Toronto, ON','42 Main St E, Windsor, US',
                        '42 Main St, Windsor, ON'):
            with self.subTest(address=address):
                text='Example Shop at '+address+' serves the area.'
                accepted,held=ai._gate({'claims':[dict(CLAIM,address=address,exact_quote=text)]},context,[dict(SOURCE,text=text)])
                self.assertEqual(accepted,[]);self.assertIn('address_requires_reconciliation',held[0]['hold_reasons'])

    def test_location_does_not_imply_lease_or_ownership(self):
        ai=self.client(lambda _:self.fail('gate-only test'))
        context=dict(SITE,addresses=['42 Main St'])
        for role in ('tenant','owner','manager'):
            accepted,held=ai._gate({'claims':[dict(CLAIM,relationship=role)]},context,[SOURCE])
            self.assertEqual(held,[]);self.assertEqual(accepted[0]['relationship'],'located_at')
            self.assertEqual(accepted[0]['claimed_relationship'],role)
            self.assertIn('does not explicitly establish',accepted[0]['relationship_review_gap'])
        text='Example Shop leases its office at 42 Main St in Windsor.'
        accepted,held=ai._gate({'claims':[dict(CLAIM,exact_quote=text)]},context,[dict(SOURCE,text=text)])
        self.assertEqual(accepted[0]['relationship'],'tenant')
        self.assertFalse(accepted[0]['occupancy_verified'])

    def test_real_5259_5659_conflict_is_not_normalized_away(self):
        ai=self.client(lambda _:self.fail('gate-only test'))
        text='Windsor Croatian Centre Limited, 5659 Tecumseh Road East, Windsor, Ontario to operate the Public Hall'
        claim=dict(CLAIM,organization='Windsor Croatian Centre Limited',address='5659 Tecumseh Road East, Windsor, ON',exact_quote=text)
        accepted,held=ai._gate({'claims':[claim]},dict(SITE,addresses=['5259 TECUMSEH RD E']),[dict(SOURCE,text=text)])
        self.assertEqual(accepted,[]);self.assertIn('address_requires_reconciliation',held[0]['hold_reasons'])

    def test_named_heritage_house_is_context_not_business(self):
        text='694 Victoria Avenue Abner Nash House is listed in the heritage register.'
        claim=dict(CLAIM,organization='Abner Nash House',entity_kind='building',address='694 Victoria Avenue',
                   relationship='located_at',exact_quote=text,temporal_status='unknown')
        def call(body):return response({'claims':[claim],'gaps':['Current occupants unknown'],'needs_review':False})
        result=self.client(call).analyze(dict(SITE,addresses=['694 VICTORIA AVE']),[dict(SOURCE,text=text)])
        self.assertEqual(result['claims'],[]);self.assertEqual(len(result['context_claims']),1)
        self.assertEqual(result['context_claims'][0]['entity_kind'],'building')
        self.assertFalse(result['escalated']);self.assertFalse(result['occupancy_verified'])

    def test_explicit_foreign_country_is_held_and_search_is_grounded(self):
        calls=[]
        text='Example Shop is at 42 Main St in Windsor, United States.'
        def call(body):
            calls.append(body)
            return response({'claims':[dict(CLAIM,exact_quote=text)],'gaps':[],'needs_review':False})
        result=self.client(call).analyze(SITE,[dict(SOURCE,text=text)])
        self.assertEqual(result['claims'],[])
        self.assertIn('source_country_conflicts_with_target',result['held_claims'][0]['hold_reasons'])
        context=json.loads(calls[0]['input'][1]['content'])['site']
        self.assertEqual(context['country'],'Canada');self.assertEqual(context['province'],'Ontario')


if __name__=='__main__':unittest.main()
