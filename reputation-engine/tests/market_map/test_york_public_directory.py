import gzip
import json
from pathlib import Path
import tempfile
import unittest
from urllib.parse import urlsplit
from scripts.market_map.york_public_directory import BASE,MUNICIPALITIES,root_links,listings,collect
from scripts.market_map.transport import SourceBlocked,Response

def all_body(city):
 rows=''
 for identifier,name in [('7','Fixture - Tools, Inc.'),('8','Fixture Dental')]:
  rows+='<tr><td><a class="yrk-AddressListing" href="61/'+identifier+'.html" title="Go to the business listing for '+name+', on 13-265 Test Street">'+name+' - 13-265 Test Street</a><span class="yrk-parcelId">999</span><span class="yrk-latitude">44.0</span><span class="yrk-longitude">-79.0</span><span class="yrk-streetLat">44.1</span><span class="yrk-streetLong">-79.1</span></td></tr>'
 return ('<h1>Businesses in '+city+'</h1><table>'+rows+'</table><p>*Information based on2024survey of businesses</p>').encode()
class Fake:
 def __init__(self):self.requests=0;self.bytes_fetched=0;self.robots_checked={}
 def fetch(self,url):
  self.requests+=1;city=next(c for c in MUNICIPALITIES if '/'+c.lower().replace(' ','-')+'/' in url)
  b=all_body(city) if url.endswith('all.html') else ('<h1>Businesses in '+city+' - By Category</h1><a href="all.html">All Businesses</a><a href="61/index.html">Educational Services</a>').encode();self.bytes_fetched+=len(b);return Response(b,{},url)
class YorkDirectoryTests(unittest.TestCase):
 def test_shared_parcel_never_merges_business_profiles(self):
  r=listings(all_body('Aurora'),BASE+'aurora/all.html','Aurora',{'61':'Educational Services'},'x')
  self.assertEqual(len(r),2);self.assertEqual(len({x['source_record_id'] for x in r}),2);self.assertEqual(len({x['publisher_map_parcel_identifier'] for x in r}),1);self.assertEqual(r[0]['name'],'Fixture - Tools, Inc.');self.assertEqual(r[0]['address'],'13-265 Test Street');self.assertEqual(r[0]['latitude'],44.0);self.assertEqual(r[0]['raw_payload']['street_view_latitude'],'44.1');self.assertIsNone(r[0]['province'])
 def test_missing_city_or_wrong_release_cannot_be_complete(self):
  with self.assertRaises(SourceBlocked):root_links(b'<a href="aurora/index.html">Aurora</a>',BASE+'index.html')
  with self.assertRaises(SourceBlocked):listings(all_body('Aurora').replace(b'on2024',b'on2022'),BASE+'aurora/all.html','Aurora',{},'x')
 def test_complete_offered_scope_raw_sha_and_replay(self):
  with tempfile.TemporaryDirectory() as tmp:
   p=Path(tmp);root=p/'root';root.write_text(''.join('<a href="'+c.lower().replace(' ','-')+'/index.html">'+c+'</a>' for c in MUNICIPALITIES));pdf=p/'licence.test.pdf';pdf.write_bytes(b'fixture licence');txt=p/'licence.test.txt';txt.write_text('Use the Information commercially');t=Fake()
   m=collect(p/'out',root_index=root,inspection_root=p/'empty',licence_file=pdf,licence_text=txt,transport=t)
   self.assertEqual(m['status'],'completed');self.assertEqual(m['municipalities_acquired'],9);self.assertEqual(m['raw_listing_appearances'],18);self.assertEqual(m['unique_profile_urls'],18);self.assertEqual(m['unique_profile_filename_ids'],2);self.assertFalse(m['market_completeness_verified']);self.assertEqual(t.requests,18)
   again=collect(p/'out',root_index=root,inspection_root=p/'empty',licence_file=pdf,licence_text=txt,transport=t);self.assertEqual(again,m);self.assertEqual(t.requests,18)
   f=p/'out'/m['collections'][0]['folder'];r=json.loads((f/'collection.json').read_text())
   with (f/r['all_raw']['file']).open('ab') as s:s.write(b'tampered')
   with self.assertRaises(SourceBlocked):collect(p/'out',root_index=root,inspection_root=p/'empty',licence_file=pdf,licence_text=txt,transport=t)
