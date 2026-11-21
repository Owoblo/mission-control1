import unittest
from scripts.market_map.streetsville_directory import parse_facts,client_arguments,URL
from scripts.market_map.transport import SourceBlocked
class StreetsvilleTests(unittest.TestCase):
 def test_main_native_controller_excludes_duplicate_sidebar_and_nonbusiness_fields(self):
  card='<article id="post-7" class="w2dc-listing"><header class="w2dc-listing-header"><h2><a href="https://fixture.test/profile">Fixture organisation</a></h2></header><p>UNRELATED CONTACT PERSON</p></article>'
  body=('<div id="w2dc-controller-fixture">'+card+'</div><aside>'+card+'</aside>').encode();facts=parse_facts(body,'fixture');self.assertEqual(len(facts),1);self.assertEqual(facts[0]['source_record_id'],'7');self.assertNotIn('UNRELATED CONTACT PERSON',str(facts));self.assertIsNone(facts[0]['phone'])
 def test_missing_schema_or_undocumented_client_cannot_start_public_form(self):
  with self.assertRaises(SourceBlocked):parse_facts(b'<html>Unavailable</html>','fixture')
  with self.assertRaises(SourceBlocked):client_arguments(b'<html>Public directory</html>','unrelated script')
if __name__=='__main__':unittest.main()
