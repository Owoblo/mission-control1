import unittest
import tempfile,json,gzip,hashlib
from pathlib import Path
from scripts.market_map.bia_source_queue import parse_official_index,norm,build
from scripts.market_map.transport import SourceBlocked

class BiaIndexTests(unittest.TestCase):
 def test_missing_and_literal_historical_source_channels_retained_without_live_claim(self):
  body=b'<table><thead><tr><th>BIA Name</th><th>Location</th><th>Website</th></tr></thead><tbody><tr><td>Fixture Village</td><td>Toronto</td><td><a href="http://fixture.test/">http://fixture.test/</a></td></tr><tr><td>Fixture North</td><td>Outside Toronto</td><td>Not available</td></tr></tbody></table>'
  rows=parse_official_index(body);self.assertEqual(len(rows),2);self.assertIsNone(rows[1]['website_published'])
  self.assertEqual(rows[0]['website_published'],'http://fixture.test/');self.assertFalse(rows[0]['target_access_or_rights_checked'])
  self.assertEqual(rows[0]['new_businesses_collected'],0);self.assertFalse(rows[0]['market_completeness_verified'])
 def test_table_schema_errors_cannot_become_empty_complete_index(self):
  with self.assertRaises(SourceBlocked):parse_official_index(b'<html>Blocked</html>')
  self.assertEqual(norm('Bloor-Yorkville'),norm('Bloor Yorkville'))

class QueueCompletedTests(unittest.TestCase):
 def test_completed_roster_precedes_earlier_entry_review_and_keeps_unsearched_separate(self):
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp);official=root/'gta-regional-source-acquisition/official-bia-source-index-metadata';official.mkdir(parents=True)
   (official/'ontario-official-bia-website-index.response').write_bytes(b'<table><tr><th>BIA Name</th><th>Location</th><th>Website</th></tr><tr><td>Emery Village</td><td>Toronto</td><td>Not available</td></tr></table>')
   city=root/'toronto-civic-raw-acquisition/business-improvement-areas';city.mkdir(parents=True)
   body=gzip.compress(b'_id,AREA_ID,AREA_NAME\n1,1,Emery Village\n2,2,Fixture Unsearched\n');(city/'raw.csv.gz').write_bytes(body)
   (city/'manifest.json').write_text(json.dumps({'raw_file':'raw.csv.gz','raw_gzip_sha256':hashlib.sha256(body).hexdigest()}))
   check=root/'gta-regional-source-acquisition/toronto-industrial-bia-entry-inspection';check.mkdir(parents=True)
   (check/'inspection.json').write_text(json.dumps({'receipts':[{'id':'emery-village-offered-directory','url':'https://fixture.test/directory','status':'accessible'}]}))
   completed=root/'emery-village-public-api-acquisition';completed.mkdir();(completed/'manifest.json').write_text('{}')
   out=root/'output';summary=build(root,out);rows=list(map(json.loads,(out/'toronto-bia-roster-source-queue.jsonl').read_text().splitlines()))
   self.assertEqual(summary['existing_roster_cohorts_available'],1);self.assertEqual(summary['planned_unsearched_roster_lanes'],1)
   self.assertEqual(rows[0]['status'],'covered_by_existing_source');self.assertEqual(rows[0]['target_rights_status'],'See existing cohort rights')
   self.assertFalse(rows[0]['planned_lane']);self.assertTrue(rows[1]['planned_lane']);self.assertTrue(all(r['new_businesses_collected']==0 for r in rows))

if __name__=='__main__':unittest.main()
