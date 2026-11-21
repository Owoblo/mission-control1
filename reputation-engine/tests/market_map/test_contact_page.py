import hashlib,json,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
from scripts.market_map.contact_page import parse_contact_page,parser_versions
from scripts.market_map import email_extraction,phone_extraction,contact_context
from scripts.market_map.cloud import regional_contact_enrichment as regional
from scripts.market_map.transport import Response

class PageTests(unittest.TestCase):
 def receipt(self,body):return {'url':'https://business.test/','sha256':hashlib.sha256(body).hexdigest(),'captured_at':'2026-01-01T00:00:00Z'}
 def test_same_values_versions_and_no_duplicate_email_parse(self):
  body=b'<p>desk@business.test Phone: (519) 555-0123</p>'
  with patch.object(contact_context,'extract_published_emails',side_effect=AssertionError('duplicate email parser')):
   r=parse_contact_page(body,self.receipt(body))
  self.assertFalse(r['parser_errors']);self.assertEqual(r['emails'],email_extraction.extract_published_emails(body,r['capture']['url']))
  self.assertEqual(r['phones'],phone_extraction.extract_published_phones(body,r['capture']['url']))
  self.assertEqual(r,parse_contact_page(body,self.receipt(body)));self.assertEqual(r['capture']['captured_at'],'2026-01-01T00:00:00Z')
 def test_hash_parser_failure_and_encoding_uncertainty(self):
  body=b'<p>Phone: (519) 555-0123</p>'
  with self.assertRaises(ValueError):parse_contact_page(body,{**self.receipt(body),'sha256':'bad'})
  def broken(*args):raise ValueError('fixture error')
  r=parse_contact_page(body,self.receipt(body),email_parser=broken)
  self.assertIn('email',r['parser_errors']);self.assertTrue(r['phones'])
  latin=b'<meta charset="iso-8859-1"><p>caf\xe9</p>'
  self.assertTrue(parse_contact_page(latin,self.receipt(latin))['decoding_uncertainty'])
 def test_malformed_json_block_does_not_erase_valid_contact(self):
  body=b'<script type="application/ld+json">broken</script><p>desk@business.test</p>'
  r=parse_contact_page(body,self.receipt(body));self.assertTrue(r['emails']);self.assertTrue(any(k.startswith('structured:') for k in r['parser_errors']))
 def test_regional_one_fetch_and_reparse_preserves_capture_time_and_prior_results(self):
  body=b'<p>desk@business.test Phone: (519) 555-0123</p>'
  with tempfile.TemporaryDirectory() as temp,patch.object(regional,'OUT',Path(temp)),patch.object(regional,'Transport') as factory:
   client=factory.return_value;client.fetch.return_value=Response(body,{},'https://business.test/')
   group={'host':'business.test','seeds':['https://business.test/'],'records':[]}
   first=regional.capture(group);self.assertEqual(client.fetch.call_count,1)
   page=first['pages'][0];at=page['captured_at']
   folder=Path(page['body_path']).parent;old=json.loads((folder/'receipt.json').read_text());old['pages'][0]['parser_versions']={'phone':'old'};old['pages'][0]['structured_contacts']=[{'retained':'old projection'}];(folder/'receipt.json').write_text(json.dumps(old))
   second=regional.capture(group);self.assertEqual(client.fetch.call_count,1)
   self.assertEqual(second['pages'][0]['captured_at'],at);self.assertTrue(second['pages'][0]['parse_history']);self.assertEqual(second['pages'][0]['parser_versions'],parser_versions())
   self.assertEqual(second['pages'][0]['parse_history'][0]['structured_contacts'],[{'retained':'old projection'}])
