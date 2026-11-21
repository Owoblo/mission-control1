import unittest
from scripts.market_map.gta_bia_project_relationships import extract
class BiaProjectTests(unittest.TestCase):
 def test_only_org_targets_in_explicit_project_partner_paragraph(self):
  body=b'<p>In partnership with <a href="https://www.bloorannex.ca/">Bloor Annex BIA</a>, <a href="https://redefinearts.ca/">ReDefine Arts</a> and artist <a href="https://person.fixture.test/">EXCLUDED PERSON</a></p><footer><a href="https://stopgap.ca/">Generic link</a></footer>'
  claims=extract(body,'steps');self.assertEqual(len(claims),2);self.assertNotIn('EXCLUDED PERSON',str(claims));self.assertTrue(all(c['relationship_temporal_status'].startswith('Project-scoped') for c in claims))
 def test_no_partnership_from_name_alone_or_unrelated_links(self):
  self.assertEqual(extract(b'<p>Fixture Partners Inc <a href="https://dtah.com">DTAH</a></p>','bloor'),[])
if __name__=='__main__':unittest.main()
