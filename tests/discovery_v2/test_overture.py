import sys,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'scripts/discovery_v2'))
from import_overture import normalize_feature
class OvertureTests(unittest.TestCase):
 def feature(self):return {'type':'Feature','geometry':{'type':'Point','coordinates':[1,1]},'properties':{'id':'gers-1','names':{'primary':'Place'},'confidence':.99,'taxonomy':{'primary':'machine_shop'},'categories':{'primary':'old_label'},'sources':[{'dataset':'provider','license':'license'}]}}
 def test_provenance_and_confidence_not_conflated(self):
  r=normalize_feature(self.feature(),'release',[0,0,2,2],'date');self.assertEqual(r['categories'],'machine_shop');self.assertEqual(r['provider_existence_confidence'],.99);self.assertEqual(r['source_provenance'][0]['license'],'license');self.assertNotIn('validation',r);self.assertEqual(r['city'],'')
 def test_outside_geometry_held(self):
  with self.assertRaises(ValueError):normalize_feature(self.feature(),'release',[2,2,3,3],'date')
 def test_legacy_taxonomy_supported(self):
  f=self.feature();del f['properties']['taxonomy'];self.assertEqual(normalize_feature(f,'release',[0,0,2,2],'date')['categories'],'old_label')
if __name__=='__main__':unittest.main()
