import unittest
from scripts.market_map.research_claim_gate import triage

class GateTests(unittest.TestCase):
    def setUp(self):
        self.packet = {'sources': [{'url': 'https://example.org', 'text': 'The office email is office@example.org.'}]}
        self.claim = dict(organization='Example', relationship_or_role='office', fact='Published office email', source_url='https://example.org', exact_quote='The office email is office@example.org.')
    def run_claim(self, **kwargs):
        return triage({'claims': [self.claim]}, self.packet, **kwargs)['claims'][0]
    def test_literal_never_auto_promotes(self):
        r = self.run_claim()
        self.assertEqual(r['route'], 'semantic_review')
        self.assertFalse(r['semantic_approved'])
        self.assertFalse(r['outreach_eligible'])
    def test_altered_quote_escalates_once(self):
        self.claim['exact_quote'] = 'The owner email is office@example.org.'
        self.assertEqual(self.run_claim()['route'], 'stronger_model_review')
        self.assertEqual(self.run_claim(escalation_count=1)['route'], 'unresolved')
    def test_missing_source_needs_acquisition_not_guessing(self):
        self.claim['source_url'] = 'https://missing.example'
        self.assertEqual(self.run_claim()['route'], 'source_acquisition')
    def test_short_exact_quote_is_held(self):
        self.claim['exact_quote'] = 'office'
        self.assertIn('quotation_too_short', self.run_claim()['reasons'])
    def test_missing_entity_is_held(self):
        self.claim['organization'] = ''
        self.assertIn('required_field_missing', self.run_claim()['reasons'])
