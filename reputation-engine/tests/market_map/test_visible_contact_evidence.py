import hashlib,unittest
from scripts.market_map.visible_contact_evidence import blocks,blocks_for_numbers
class VisibleEvidenceTests(unittest.TestCase):
 def test_email_or_url_tokens_do_not_supply_the_business_name(self):
  self.record={'organization':'Example','address':'12 Main St','municipality':'Essex','phone_base':'5195550123'}
  self.assertEqual(self.find('<footer>example@business.ca 12 Main St Essex 519-555-0123</footer>'),[])
  self.assertEqual(self.find('<footer>https://example.ca 12 Main St Essex 519-555-0123</footer>'),[])
  self.assertEqual(self.find('<footer>www.example.ca 12 Main St Essex 519-555-0123</footer>'),[])
 def setUp(self):self.record={'organization':'Example Business','address':'12 Main St W','municipality':'Essex','source_city_label':'Harrow','phone_base':'5195550123'}
 def find(self,body):
  body=body.encode();return blocks(body,self.record,hashlib.sha256(body).hexdigest())
 def test_explicit_block_is_review_evidence_only(self):
  r=self.find('<footer>Example Business, 12 Main Street West, Harrow ON. Call 519-555-0123</footer>');self.assertEqual(len(r),1);self.assertTrue(r[0]['review_required']);self.assertFalse(r[0]['send_ready'])
 def test_distant_page_fields_are_not_joined(self):
  self.assertEqual(self.find('<html><body><div>Example Business</div><div>12 Main St W Harrow</div><div>519-555-0123</div></body></html>'),[])
 def test_multiple_numbers_fax_wrong_city_and_hidden_do_not_qualify(self):
  for text in ['Example Business 12 Main St W Harrow 519-555-0123 519-555-9999','Example Business 12 Main St W Harrow Fax 519-555-0123','Example Business 12 Main St W Toronto 519-555-0123']:
   self.assertEqual(self.find('<footer>'+text+'</footer>'),[])
  self.assertEqual(self.find('<html><body><div hidden>Example Business 12 Main St W Harrow 519-555-0123</div></body></html>'),[])
 def test_hash_mismatch_does_not_qualify(self):self.assertEqual(blocks(b'<footer>Example Business 12 Main St W Harrow 519-555-0123</footer>',self.record,'wrong'),[])
 def test_extension_in_separate_dom_nodes_requires_review(self):
  for suffix in ['<span>ext.</span><span>213</span>','<span>Extension:</span><b>213</b>','<span>x</span>213','<span>#</span><span>213</span>']:
   with self.subTest(suffix=suffix):
    self.assertEqual(self.find('<footer>Example Business 12 Main St W Harrow <a href="tel:5195550123">519-555-0123</a>'+suffix+'</footer>'),[])
 def test_unrelated_extension_word_is_not_an_extension_number(self):
  self.assertEqual(len(self.find('<footer>Example Business 12 Main St W Harrow 519-555-0123. Ask about our service extension plans.</footer>')),1)
 def test_smallest_block_preserves_provenance(self):
  r=self.find('<div>Other prose<footer>Example Business 12 Main St W Harrow 519-555-0123</footer></div>');self.assertEqual(len(r),1);self.assertNotIn('Other prose',r[0]['excerpt']);self.assertIn('footer',r[0]['source_dom_locator'])
 def test_multiple_observed_numbers_keep_independent_blocks_and_map_phone(self):
  body=b'<div><section>Example Business 12 Main St W Harrow 519-555-0123</section><section>Example Business 12 Main St W Harrow 519-555-0124</section></div>'
  before=dict(self.record);digest=hashlib.sha256(body).hexdigest()
  r=blocks_for_numbers(body,self.record,{'+15195550123','+15195550124'},digest)
  self.assertEqual(set(r),{'+15195550123','+15195550124'});self.assertEqual(self.record,before)
  self.assertEqual(blocks(body,self.record,digest),r['+15195550123'])
 def test_multiple_numbers_in_same_block_still_require_context_review(self):
  body=b'<footer>Example Business 12 Main St W Harrow 519-555-0123 519-555-0124</footer>'
  self.assertEqual(blocks_for_numbers(body,self.record,{'+15195550123','+15195550124'},hashlib.sha256(body).hexdigest()),{})
if __name__=='__main__':unittest.main()
