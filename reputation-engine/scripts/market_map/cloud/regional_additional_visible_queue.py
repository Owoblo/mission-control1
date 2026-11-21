"""Read-only compact-block queue for additional website phones, never verification."""
import datetime,json
from pathlib import Path
from urllib.parse import urlsplit
from scripts.market_map.visible_contact_evidence import blocks_for_numbers
from scripts.market_map.cloud.regional_identity_review import fresh
ROOT=Path('/data/research/artifacts/regional-contact-enrichment-20261104')

def main():
 now=datetime.datetime.now(datetime.timezone.utc)
 report=json.loads((ROOT/'additional-phone-source-review.json').read_text())
 targets={r['phone']:r for r in report['rows'] if r['state']=='source_association_review_required' and set(r['source_holds'])=={'no_scoped_structured_identity'}}
 rows={};pages=0;errors=0;ambiguous_sites=0
 for path in sorted((ROOT/'sources').glob('*/receipt.json')):
  receipt=json.loads(path.read_text())
  if len(receipt['records'])!=1:
   ambiguous_sites+=1;continue
  record=receipt['records'][0]
  for page in receipt['pages']:
   numbers={o['phone'] for o in page['phones'] if o.get('phone') in targets and o.get('kind')!='fax' and not o.get('extension')}
   if not numbers or not fresh(page.get('captured_at'),now):continue
   if (urlsplit(page['url']).hostname or '').removeprefix('www.')!=receipt['host']:continue
   try:
    evidence=blocks_for_numbers(Path(page['body_path']).read_bytes(),record,numbers,page['sha256']);pages+=1
   except (OSError,ValueError,AttributeError):errors+=1;continue
   for phone,blocks in evidence.items():
    row=rows.setdefault(phone,{'phone':phone,'records':{},'evidence':[],'source_holds':targets[phone]['source_holds'],
      'state':'additional_visible_contact_evidence_requires_review','carrier_checked':False,'send_ready':False,'owner_send_hold':True})
    row['records'][record['source_record_id']]=record
    row['evidence'].append({**blocks[0],'source_record_id':record['source_record_id'],'source_url':page['url'],'captured_at':page['captured_at']})
 for row in rows.values():row['records']=list(row['records'].values())
 summary={'checked_at':now.isoformat(),'source_checked_at':report['summary']['checked_at'],'eligible_additional_numbers':len(targets),
  'pages_scanned':pages,'candidates_with_compact_visible_evidence':len(rows),'multi_record_sites_deferred':ambiguous_sites,'read_errors':errors,
  'carrier_calls':0,'messages_sent':0,'verified_unique_contacts':0,'send_ready':0,'owner_send_hold':True}
 target=ROOT/'additional-visible-review-queue.json';temp=target.with_suffix('.tmp');temp.write_text(json.dumps({'summary':summary,'rows':list(rows.values())},indent=2));temp.replace(target)
 print(json.dumps(summary))

if __name__=='__main__':main()
