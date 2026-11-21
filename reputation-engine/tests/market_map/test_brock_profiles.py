import unittest,json
from scripts.market_map.brock_profiles import parse_profile,sitemap_urls
from scripts.market_map.transport import SourceBlocked

class BrockProfileTests(unittest.TestCase):
 def test_public_business_fields_only_not_contact_person_or_footer(self):
  body=b'<html><header><h1>Publisher</h1></header><main><h1>Fixture Health Centre</h1><p>Excluded Named Contact</p><p>Excluded narrative with details.</p><a href="mailto:person@fixture.test">person@fixture.test</a><p>705-555-0100</p><a href="https://fixture.test/">https://fixture.test/</a></main><footer>99 Footer St, Brock, ON</footer></html>'
  row=parse_profile(body,'https://www.brockboardoftrade.com/community-partners/fixture','partner','fixture')
  self.assertEqual(row['name'],'Fixture Health Centre');self.assertEqual(row['phone'],'705-555-0100');self.assertEqual(row['website'],'https://fixture.test/')
  self.assertNotIn('Excluded',json.dumps(row));self.assertIsNone(row['city']);self.assertIsNone(row['address']);self.assertIsNone(row['email'])
  self.assertEqual(row['relationships'][0]['relationship_type'],'listed_as_community_partner')
 def test_sitemap_scope_excludes_user_profiles_and_duplicate_inventory(self):
  def xml(urls):return ('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'+''.join('<url><loc>'+u+'</loc></url>' for u in urls)+'</urlset>').encode()
  good='https://www.brockboardoftrade.com/members/fixture'
  self.assertEqual(sitemap_urls(xml([good]),'member'),[good])
  for urls in [[good,good],['https://www.brockboardoftrade.com/profile/personal-user']]:
   with self.assertRaises(SourceBlocked):sitemap_urls(xml(urls),'member')

if __name__=='__main__':unittest.main()
