"""Import a pinned, bounded GeoJSON sequence as place evidence, never as verified leads."""
import argparse,json,math
from pathlib import Path
from datetime import datetime,timezone
from engine import Engine,norm,host

def normalize_feature(feature,release,bbox,observed_at):
 p=feature.get('properties',{});geometry=feature.get('geometry') or {};coordinates=geometry.get('coordinates',[])
 if geometry.get('type')!='Point' or len(coordinates)!=2:raise ValueError('Expected point geometry')
 x,y=coordinates
 if not all(isinstance(v,(int,float)) and math.isfinite(v) for v in [x,y]) or not (bbox[0]<=x<=bbox[2] and bbox[1]<=y<=bbox[3]):raise ValueError('Feature outside pilot bounding box')
 identifier=p.get('id');name=(p.get('names') or {}).get('primary')
 if not identifier or not name:raise ValueError('Missing GERS ID or name')
 addresses=p.get('addresses') or [];address=addresses[0] if addresses else {};taxonomy=p.get('taxonomy') or {};legacy=p.get('categories') or {};category=taxonomy.get('primary') or p.get('basic_category') or legacy.get('primary') or ''
 return {'source_namespace':'overture_gers','source_record_id':identifier,'name':name,'source_url':f'https://stac.overturemaps.org/{release}/catalog.json#gers={identifier}','city':address.get('locality') or '', 'address':address.get('freeform') or '', 'website':(p.get('websites') or [''])[0],'categories':category,'status':'collected','checked_at':observed_at,'entity_kind':'place_candidate','external_id':identifier,'external_scheme':'overture_gers','release':release,'coordinates':coordinates,'addresses':addresses,'provider_existence_confidence':p.get('confidence'),'source_provenance':p.get('sources') or [],'raw_taxonomy':{'taxonomy':taxonomy,'basic_category':p.get('basic_category'),'categories':legacy},'published_phones':p.get('phones') or [],'scope_note':'Bounding-box place; business identity, serviceability and contact eligibility unverified'}

def main():
 a=argparse.ArgumentParser();a.add_argument('--input',type=Path,required=True);a.add_argument('--manifest',type=Path,required=True);a.add_argument('--database',type=Path,required=True);a.add_argument('--output',type=Path,required=True);args=a.parse_args();manifest=json.loads(args.manifest.read_text());release=manifest['release'];bbox=manifest['bbox'];when=datetime.fromtimestamp(args.input.stat().st_mtime,timezone.utc).isoformat();rows=[];held=[]
 if args.input.stat().st_size>10_000_000:raise ValueError('Input exceeds pilot artifact cap')
 for i,line in enumerate(args.input.read_text().splitlines()):
  if not line.strip():continue
  if len(rows)+len(held)>=2000:raise ValueError('Pilot row cap exceeded')
  try:rows.append(normalize_feature(json.loads(line.lstrip('\x1e')),release,bbox,when))
  except (ValueError,TypeError,KeyError) as ex:held.append({'line':i+1,'reason':str(ex)})
 if len(rows)+len(held)!=manifest['rows']:raise ValueError('Download count does not match manifest')
 engine=Engine(args.database)
 # Compare with directory observations, including website fields found during enrichment.
 existing={}
 for o in engine.db.execute('SELECT o.entity_id,o.payload FROM observations o JOIN runs r ON r.id=o.run_id WHERE r.family<>?',('open_places',)):
  r=json.loads(o['payload']);entry=existing.setdefault(o['entity_id'],{'name':r.get('name',''),'city':r.get('city',''),'address':r.get('address',''),'domains':set()});h=host(r.get('website',''))
  if h:entry['domains'].add(h)
 matches=[];unmatched=[]
 for r in rows:
  candidates=[]
  for eid,e in existing.items():
   if norm(e['city'])!=norm(r['city']):continue
   same_name=norm(e['name'])==norm(r['name']);same_domain=host(r['website']) in e['domains'] if r['website'] else False
   if same_name or same_domain:candidates.append({'entity_id':eid,'name':e['name'],'same_normalized_name':same_name,'same_domain':same_domain,'address':e['address']})
  if candidates:matches.append({'gers':r['external_id'],'name':r['name'],'address':r['address'],'candidates':candidates,'status':'review_required_not_merged'})
  else:unmatched.append(r['external_id'])
 result=engine.ingest(source='overture:'+release,namespace='overture_gers',family='open_places',scope='woodstock-bbox-pilot',category='*',rows=rows,captured_at=when,coverage_complete=False)
 report={'ingestion':result,'release':release,'bbox':bbox,'input_place_records':len(rows),'held':held,'possible_directory_overlaps':len(matches),'no_candidate_match':len(unmatched),'match_candidates':matches,'limitations':['Possible overlaps use exact locality plus name OR domain; they require identity review.','No-candidate-match is not a count of newly discovered companies.','Directory coverage and bounding-box coverage differ. This is not a recall/completeness score.','Provider existence confidence is preserved separately; it is not mailbox or purchasing confidence.'],'unmatched_gers':unmatched};args.output.mkdir(parents=True,exist_ok=True);(args.output/'comparison.json').write_text(json.dumps(report,indent=2));(args.output/'normalized-places.jsonl').write_text(''.join(json.dumps(r)+'\n' for r in rows));print(json.dumps({k:v for k,v in report.items() if k not in ['match_candidates','unmatched_gers','limitations']}))
if __name__=='__main__':main()
