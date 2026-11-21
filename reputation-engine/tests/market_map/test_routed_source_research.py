import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from scripts.market_map import routed_source_research as route
from scripts.market_map import trusted_source_capture as capture


class RoutedTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.root=Path(self.tmp.name);self.task=self.root/'task';self.task.mkdir()
        body=b'<p>Official office at Main Street with phone5195550100</p>'
        meta={'requested_url':'https://example.org/contact','status':200,'body_sha256':hashlib.sha256(body).hexdigest()}
        with patch.object(capture,'fetch',return_value=(body,meta)):
            receipt=capture.capture(meta['requested_url'],self.root/'capture',self.root)
        self.captures={meta['requested_url']:receipt}
        self.events=[{'building_id':'building:1','stage':'address','source_url':meta['requested_url'],'raw_evidence_reference':receipt['body_path'],'source_sha256':receipt['body_sha256']}]
        self.calls=[]
    def respond(self,body):
        self.calls.append(body)
        if len(self.calls)==1:
            value={'claims':[{'organization':'Office','relationship_or_role':'contact','fact':'Office at Main Street','source_url':'https://example.org/contact','exact_quote':'Invented quote that is absent from original page'}],'unknowns':['Owner unknown']}
        else:value={'corrected_events':[{'building_id':'building:1','stage':stage,'finding':'Public office address; exact footprint unknown','source_url':'https://example.org/contact','source_excerpt':'Official office at Main Street with phone5195550100','remaining_gaps':['Footprint unknown']} for stage in ('address','occupants','contacts')], 'reviews':[{'claim_index':0,'verdict':'unsupported','reason':'Quote absent; requires correction'}],'omissions':['Phone omitted'],'unknowns':['Owner unknown']}
        return {'status':'completed','usage':{'input_tokens':100,'output_tokens':30},'output':[{'content':[{'type':'output_text','text':json.dumps(value)}]}]}
    def test_two_stage_phase_does_not_require_contact_correction(self):
        def respond(body):
            response = self.respond(body)
            value = json.loads(response['output'][0]['content'][0]['text'])
            if 'corrected_events' in value:
                value['corrected_events'] = [e for e in value['corrected_events'] if e['stage'] != 'contacts']
                response['output'][0]['content'][0]['text'] = json.dumps(value)
            return response
        report = route.run(self.events, self.captures, self.root, self.task, 'book', call=respond, required_stages=('address', 'occupants'))
        self.assertEqual({e['stage'] for e in report['corrected_events']}, {'address', 'occupants'})

    def test_two_routes_flags_all_claims_reviewed_no_tools_or_promotion(self):
        ticks=[]
        report=route.run(self.events,self.captures,self.root,self.task,'FULL PLAYBOOK',progress=lambda:ticks.append(1),call=self.respond)
        self.assertEqual([x['model'] for x in self.calls],['gpt-6-luna','gpt-5.4'])
        self.assertEqual(report['flagged_claim_indices'],[0]);self.assertFalse(report['production_promoted'])
        self.assertEqual(report['verdict_counts'],{'supported':0,'unsupported':1,'needs_review':0})
        self.assertEqual(report['omissions'],['Phone omitted'])
        packet=json.loads((self.task/'routed-research/packet.json').read_text())
        self.assertIn('Official office at Main Street',packet['sources'][0]['text'])
        self.assertIn('Main Street',self.calls[0]['input'][1]['content'])
        self.assertEqual(len(ticks),4)
        for body in self.calls:
            self.assertNotIn('tools',body);self.assertEqual(body['max_output_tokens'],7000)
            self.assertIn('FULL PLAYBOOK',body['input'][0]['content'])
        self.assertIn('flagged_claim_indices',self.calls[1]['input'][1]['content'])
        with self.assertRaises(FileExistsError):route.run(self.events,self.captures,self.root,self.task,'FULL PLAYBOOK',call=self.respond)
        self.assertEqual(len(self.calls),2)
    def test_missing_capture_and_oversize_inputs_never_call_model(self):
        for captures,playbook in [({},'book'),(self.captures,'x'*150001)]:
            with self.assertRaises(ValueError):route.run(self.events,captures,self.root,self.task,playbook,call=self.respond)
        self.assertEqual(self.calls,[])
    def test_incomplete_response_preserves_usage_no_retry(self):
        def incomplete(body):
            self.calls.append(body)
            return {'status':'incomplete','usage':{'input_tokens':123,'output_tokens':7000},'output':[]}
        with self.assertRaises(ValueError):route.run(self.events,self.captures,self.root,self.task,'book',call=incomplete)
        saved=json.loads((self.task/'routed-research/summary.json').read_text())
        self.assertEqual(saved['routes'][0]['usage']['output_tokens'],7000)
        self.assertEqual(saved['state'],'staged_error');self.assertEqual(len(self.calls),1)
    def test_unavailable_proposal_url_uses_other_coordinator_capture(self):
        self.events[0]['source_url']='https://unavailable.example/missing'
        self.events[0]['remaining_gaps']=['Proposed page unavailable; not proof the business is absent']
        report=route.run(self.events,self.captures,self.root,self.task,'book',call=self.respond)
        self.assertEqual(len(report['corrected_events']),3)
        self.assertTrue(all(e['source_url']=='https://example.org/contact' for e in report['corrected_events']))
        packet=json.loads((self.task/'routed-research/packet.json').read_text())
        self.assertEqual([s['url'] for s in packet['sources']],['https://example.org/contact'])
        self.assertIn('unavailable.example',self.calls[1]['input'][1]['content'])
    def test_supported_model_verdict_cannot_override_quotation_hold(self):
        def overconfident(body):
            result=self.respond(body)
            if len(self.calls)==2:
                value=json.loads(result['output'][0]['content'][0]['text'])
                value['reviews'][0]['verdict']='supported'
                result['output'][0]['content'][0]['text']=json.dumps(value)
            return result
        report=route.run(self.events,self.captures,self.root,self.task,'book',call=overconfident)
        self.assertEqual(report['effective_claim_status'],[{'claim_index':0,'model_verdict':'supported','effective_status':'quotation_hold'}])
        self.assertEqual(report['effective_claim_counts']['quotation_hold'],1)
        self.assertEqual(report['effective_claim_counts']['model_supported_requires_independent_review'],0)
        self.assertEqual(report['verdict_counts']['supported'],1)
        self.assertFalse(report['production_promoted'])
    def test_foreign_corrected_url_rejected(self):
        def foreign(body):
            result=self.respond(body)
            if len(self.calls)==2:
                value=json.loads(result['output'][0]['content'][0]['text'])
                value['corrected_events'][0]['source_url']='https://foreign.example/contact'
                result['output'][0]['content'][0]['text']=json.dumps(value)
            return result
        with self.assertRaises(ValueError):route.run(self.events,self.captures,self.root,self.task,'book',call=foreign)
        self.assertFalse((self.task/'routed-research/corrected-events.json').exists())

    def test_unsupported_stage_correction_rejected(self):
        def bad(body):
            result=self.respond(body)
            if len(self.calls)==2:
                parsed=json.loads(result['output'][0]['content'][0]['text'])
                parsed['corrected_events'][1]['source_excerpt']='Invented source text with no matching evidence'
                result['output'][0]['content'][0]['text']=json.dumps(parsed)
            return result
        with self.assertRaises(ValueError):route.run(self.events,self.captures,self.root,self.task,'book',call=bad)
        self.assertFalse((self.task/'routed-research/corrected-events.json').exists())
        self.assertEqual(len(self.calls),2)

    def test_expired_deadline_stops_without_model_call(self):
        with self.assertRaises(TimeoutError):
            route.run(self.events,self.captures,self.root,self.task,'book',call=self.respond,deadline=0)
        self.assertEqual(self.calls,[])
    def test_deadline_after_first_response_retains_usage_and_stops_second(self):
        def advance(body):
            result=self.respond(body)
            clock.return_value=20
            return result
        with patch.object(route.time,'monotonic',return_value=1) as clock:
            with self.assertRaises(TimeoutError):
                route.run(self.events,self.captures,self.root,self.task,'book',call=advance,deadline=10)
        self.assertEqual(len(self.calls),1)
        saved=json.loads((self.task/'routed-research/summary.json').read_text())
        self.assertEqual(saved['routes'][0]['usage']['input_tokens'],100)

    def test_partial_semantic_review_rejected_without_verification(self):
        def missing(body):
            result=self.respond(body)
            if len(self.calls)==2:result['output'][0]['content'][0]['text']=json.dumps({'reviews':[],'omissions':[],'unknowns':[]})
            return result
        with self.assertRaises(ValueError):route.run(self.events,self.captures,self.root,self.task,'book',call=missing)
        saved=json.loads((self.task/'routed-research/summary.json').read_text())
        self.assertFalse(saved['production_promoted']);self.assertEqual(len(saved['routes']),2)

if __name__=='__main__':unittest.main()
