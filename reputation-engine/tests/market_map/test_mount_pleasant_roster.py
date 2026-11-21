import unittest
from scripts.market_map.mount_pleasant_roster import parse_page,normalise,URL
from scripts.market_map.transport import SourceBlocked
class MountDirectoryTests(unittest.TestCase):
 def test_profile_ids_keep_shared_name_branches_separate_and_footer_not_location(self):
  body=b'<div><a class="business-name-directory" href="/listing/fixture-one/">Fixture</a><p class="business-address">10 Fiction Rd</p></div><div><a class="business-name-directory" href="/listing/fixture-two/">Fixture</a><p class="business-address">20 Fiction Rd</p></div><footer>Toronto ON</footer><a class="js-wpv-pagination-next-link" href="?wpv_view_count=876&amp;wpv_paged=2">Next</a>'
  rows,next_url=parse_page(body,URL);self.assertEqual(len(rows),2);self.assertNotEqual(rows[0]['profile_url'],rows[1]['profile_url']);self.assertTrue(next_url.endswith('wpv_paged=2'));self.assertIsNone(normalise(rows[0],'fixture',URL)['city'])
 def test_missing_or_repeated_cards_block_instead_of_zero_complete(self):
  with self.assertRaises(SourceBlocked):parse_page(b'<html>Blocked</html>',URL)
  body=b'<div><a class="business-name-directory" href="/listing/a/">Fixture</a><p class="business-address">10 Fiction Rd</p></div>'
  with self.assertRaises(SourceBlocked):parse_page(body+body,URL)
if __name__=='__main__':unittest.main()
