import unittest
from market_map.physical_tiles import tile_keys,rounded

class DisplayTileTests(unittest.TestCase):
 def test_negative_longitude_uses_floor_and_retains_cross_tile_feature(self):
  keys=tile_keys((-79.401,43.701,-79.399,43.703))
  self.assertEqual({x for x,y in keys},{-3971,-3970})
  self.assertTrue(all(y==2185 for x,y in keys))

 def test_geometry_rounding_does_not_round_source_ids(self):
  original={'id':'12345678901234567890','coordinates':((-79.123456789,43.1),),'properties':{'id':12345678901234567890}}
  result=rounded(original)
  self.assertEqual(result['coordinates'],[[-79.123457,43.1]])
  self.assertEqual(result['id'],original['id'])
  self.assertEqual(result['properties'],original['properties'])
  self.assertEqual(original['coordinates'][0][0],-79.123456789)

if __name__=='__main__':unittest.main()
