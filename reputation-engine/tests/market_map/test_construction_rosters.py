import gzip
import json
import tempfile
import unittest
from pathlib import Path
from scripts.market_map.construction_rosters import parse_bild,parse_mcahn,collect_bild,sha,qualify_snapshot_positions,bild_terminal
from scripts.market_map.transport import Response,SourceBlocked

def card(name='Fixture Builders',city='Toronto, ON'):
 return f'<div class="max-card-width"><a href="https://fixture.test/"><div class="info-container"><h3 class="title">{name}</h3><span class="city">{city}</span><span class="type">Renovator</span><span class="start_date">Member Since 01/02/2020</span></div></a></div>'.encode()
def initial():return b'<div class="member-card-list">'+card()+b'</div><div class="new-member-card-list">'+card('Footer New Member')+b'</div>'

class FakeTransport:
 def __init__(self,fail=False):self.requests=0;self.fail=fail
 def _stamp(self):return '2026-10-27T00:00:00Z'
 def metrics(self):return {'requests':self.requests,'bytes_fetched':self.requests*10,'elapsed_seconds':0}
 def fetch_public_form(self,url,fields,**kwargs):
  self.requests+=1
  if self.fail:raise SourceBlocked('Fixture access block')
  return Response(card('Other Fixture') if fields['page']==1 else b'',{},url)
 def fetch(self,url):self.requests+=1;return Response(initial(),{},url)

class ConstructionTests(unittest.TestCase):
 def test_bild_retains_odd_publisher_region_and_excludes_new_member_footer(self):
  rows=parse_bild(initial(),source_page=0,observed_at='fixture',initial=True)
  self.assertEqual(len(rows),1);self.assertEqual(rows[0]['city'],'Toronto')
  odd=parse_bild(card(city='Kelowna, ON'),source_page=1,observed_at='fixture')[0]
  self.assertEqual((odd['city'],odd['province']),('Kelowna','ON'))
  self.assertIsNone(odd['address']);self.assertFalse(odd['campaign_ready'])
 def test_mcahn_excludes_people_and_board_but_retains_published_business_facts(self):
  body=b'<div class="directory"><h3 class="pagetitle">Our Members</h3><p><b>Fixture Mechanical</b><br><a href="https://fixture.test/">www.fixture.test</a><br>12 Main St.<br>Toronto, ON M1A 1A1<br><b>T:</b>416-555-0100</p></div><div class="directory"><h3 class="pagetitle">Associate Members</h3><p><b>Fixture Valves</b><br>13 Main St.<br>Hamilton, ON L8A 1A1<br>Contact: Named Person<br><b>T:</b>905-555-0101</p></div><div class="directory"><h3 class="pagetitle">Board of Directors</h3><p><b>Named Person</b></p></div>'
  rows,sections=parse_mcahn(body,observed_at='fixture')
  self.assertEqual(len(rows),2);self.assertNotIn('Named Person',json.dumps(rows))
  self.assertEqual(rows[0]['city'],'Toronto');self.assertEqual(rows[1]['relationships'][0]['qualification'],'Associate Members')
  self.assertEqual(sections,{'Our Members':1,'Associate Members':1})
 def test_bild_page_recovery_and_frozen_replay(self):
  with tempfile.TemporaryDirectory() as folder:
   root=Path(folder);inspection=root/'inspection';inspection.mkdir();raw=inspection/'bild-member-directory.response';raw.write_bytes(initial())
   (inspection/'inspection.json').write_text(json.dumps({'receipts':[{'id':'bild-member-directory','sha256':sha(raw),'observed_at':'fixture'}]}))
   output=root/'collection';failed=FakeTransport(fail=True)
   with self.assertRaises(SourceBlocked):collect_bild(inspection,output,transport=failed)
   self.assertEqual(len(json.loads((output/'checkpoint.json').read_text())['pages']),1)
   transport=FakeTransport();manifest=collect_bild(inspection,output,transport=transport)
   self.assertEqual(manifest['raw_factual_rows'],2);self.assertEqual(manifest['terminal_page'],2)
   self.assertEqual(manifest['metrics']['requests'],4)
   replay=FakeTransport(fail=True);self.assertEqual(collect_bild(inspection,output,transport=replay),manifest)
   self.assertEqual(replay.requests,0)
   with gzip.open(output/'business-member-facts.jsonl.gz','rt') as stream:self.assertEqual(len(list(stream)),2)
 def test_actual_publisher_css_end_marker_is_distinct_from_access_error(self):
  self.assertEqual(bild_terminal(b'<style>.load-more-member-cards { display: none; }</style><script>inert</script>'),'publisher_css_hides_load_more')
  self.assertIsNone(bild_terminal(b'<html>Access denied</html>'))
  self.assertIsNone(bild_terminal(b'0'))

 def test_unexpected_nonempty_response_never_becomes_empty_complete_roster(self):
  with self.assertRaises(SourceBlocked):parse_bild(b'<html>Access denied</html>',source_page=1,observed_at='fixture')
 def test_html_position_identity_is_qualified_by_snapshot_and_replays_without_rewriting(self):
  with tempfile.TemporaryDirectory() as folder:
   output=Path(folder);original=output/'business-member-facts.jsonl.gz'
   with gzip.open(original,'wt') as stream:stream.write(json.dumps({'source_record_id':'Our Members:1','name':'Fixture Company','raw_payload':{'name':'Fixture Company'}})+'\n')
   digest=sha(original);(output/'manifest.json').write_text(json.dumps({'raw_source_sha256':'a'*64}))
   proof=qualify_snapshot_positions(output)
   with gzip.open(output/proof['preferred_records'],'rt') as stream:row=json.loads(next(stream))
   self.assertEqual(row['source_record_id'],'snapshot:'+'a'*64+':Our Members:1')
   self.assertEqual(row['name'],'Fixture Company');self.assertEqual(sha(original),digest)
   self.assertEqual(qualify_snapshot_positions(output),proof)
   (output/'manifest.json').write_text(json.dumps({'raw_source_sha256':'b'*64}))
   with self.assertRaises(SourceBlocked):qualify_snapshot_positions(output)

if __name__=='__main__':unittest.main()
