import unittest
from scripts.market_map.neighbourhood_bia_snapshots import parse_bloor,parse_college
from scripts.market_map.transport import SourceBlocked

class SnapshotTests(unittest.TestCase):
 def test_bloor_shared_names_keep_separate_addresses_and_missing_contact(self):
  rows=parse_bloor(b'<div class="entry-content"><p><strong>Fixture Repair</strong><br>10 Bloor St W<br>T: 416-555-0100<br><a href="https://fixture.test">fixture.test</a></p><hr><p><strong>Fixture Repair</strong><br>20 Bloor St W<br>T:</p></div>')
  self.assertEqual(len(rows),2);self.assertEqual(rows[0]['name'],rows[1]['name']);self.assertNotEqual(rows[0]['address_lines'],rows[1]['address_lines']);self.assertIsNone(rows[1]['phone']);self.assertEqual(rows[1]['published_websites'],[]);self.assertIsNone(rows[0]['source_native_id'])
 def test_college_explicit_blank_line_boundaries_keep_all_source_blocks(self):
  body=('<div class="paragraph">'+''.join('<strong>Fixture '+str(i)+'</strong><br>'+str(i)+' Fixture Rd<br>(416) 555-0100<br><br>' for i in range(21))+'</div>').encode()
  rows=parse_college(body);self.assertEqual(len(rows),21);self.assertEqual(rows[20]['address_lines'],['20 Fixture Rd']);self.assertEqual(rows[0]['source_ordinal'],1)
 def test_invalid_roster_or_ambiguous_name_boundary_cannot_claim_empty_complete(self):
  with self.assertRaises(SourceBlocked):parse_bloor(b'<html>Access blocked</html>')
  body=('<div class="paragraph">'+''.join('<strong>Fixture</strong><br>No street boundary<br><br>' for i in range(21))+'</div>').encode()
  with self.assertRaises(SourceBlocked):parse_college(body)

if __name__=='__main__':unittest.main()
