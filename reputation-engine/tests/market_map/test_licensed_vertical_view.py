import csv,gzip,tempfile,unittest
from pathlib import Path
from scripts.market_map.licensed_vertical_view import build,select

class VerticalTests(unittest.TestCase):
 def test_code_only_never_guesses_canadian_naics_version_or_affiliation(self):
  self.assertEqual(select({'name':'Fixture Electronics','source_naics_primary':'443143','source_business_sector':'Retail'},'historical'),[])
  self.assertTrue(select({'name':'Fixture','source_category':'appliances_and_repair'},'map'))
 def test_source_identity_scope_overlap_and_historical_rows_remain_separate(self):
  with tempfile.TemporaryDirectory() as folder:
   root=Path(folder);inputs=[]
   specs=[('one','map',{'provider_gers_id':'fixture-gers','provider_release':'fixture-release','name':'Fixture Appliances','source_category':'appliance_store','city':'Toronto'}),
          ('two','map',{'provider_gers_id':'fixture-gers','provider_release':'fixture-release','name':'Fixture Appliances','source_category':'appliance_store','city':'Toronto'}),
          ('historic','historical',{'source_observation_id':'fixture-historical','name':'Fixture Appliances','source_business_sector':'Appliance stores','publication_date':'2023-11-28'})]
   for cohort,kind,row in specs:
    path=root/(cohort+'.csv.gz')
    with gzip.open(path,'wt',newline='') as stream:writer=csv.DictWriter(stream,fieldnames=list(row));writer.writeheader();writer.writerow(row)
    inputs.append({'cohort':cohort,'kind':kind,'path':path})
   output=root/'output';m=build(inputs,output);self.assertEqual(m['selected_source_observations'],2)
   self.assertEqual(m['new_businesses_collected'],0);self.assertEqual(build(inputs,output),m)
   with gzip.open(output/'appliance-name-or-category-research-candidates.csv.gz','rt') as stream:rows=list(csv.DictReader(stream))
   self.assertEqual(len(rows),2);self.assertEqual({x['source_kind'] for x in rows},{'map','historical'})
   self.assertTrue(all(x['brand_affiliation_verified']=='False' for x in rows));self.assertTrue(all(x['campaign_ready']=='False' for x in rows))

if __name__=='__main__':unittest.main()
