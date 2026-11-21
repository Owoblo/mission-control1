"""Prioritize cached visible contact evidence. Zero new API calls or messages."""
import datetime,json
from pathlib import Path
from urllib.parse import urlsplit
from scripts.market_map.visible_contact_evidence import blocks
ROOT=Path('/data/research/artifacts/regional-contact-enrichment-20261104')
def main():
 report=json.loads((ROOT/'source-identity-review.json').read_text())
 pending={r['phone']:r for r in report['rows'] if r['state']=='source_identity_review_required'}
 rows={};errors=0
 for path in sorted((ROOT/'sources').glob('*/receipt.json')):
  receipt=json.loads(path.read_text())
  for record in receipt['records']:
   number='+1'+str(record.get('phone_base',''))
   if number not in pending:continue
   for page in receipt['pages']:
    try:
     if urlsplit(record['website']).hostname.lower().removeprefix('www.')!=urlsplit(page['url']).hostname.lower().removeprefix('www.'):continue
     evidence=blocks(Path(page['body_path']).read_bytes(),record,page['sha256'])
    except (OSError,ValueError,AttributeError):errors+=1;continue
    if not evidence:continue
    row=rows.setdefault(number,{'phone':number,'carrier_checked_at':pending[number]['carrier_checked_at'],'source_holds':pending[number]['source_holds'],'records':{},'evidence':[],'state':'visible_contact_evidence_requires_review','send_ready':False,'owner_send_hold':True})
    row['records'][record['source_record_id']]=record
    row['evidence'].append({**evidence[0],'source_record_id':record['source_record_id'],'source_url':page['url'],'captured_at':page['captured_at']})
 for row in rows.values():row['records']=list(row['records'].values())
 summary={'checked_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'source_checked_at':report['checked_at'],'pending_candidates':len(pending),'candidates_with_compact_visible_evidence':len(rows),'read_errors':errors,'new_api_calls':0,'messages_sent':0,'send_ready':0,'owner_send_hold':True}
 target=ROOT/'visible-contact-review-queue.json';tmp=target.with_suffix('.tmp');tmp.write_text(json.dumps({'summary':summary,'rows':list(rows.values())},indent=2));tmp.replace(target);print(json.dumps(summary))
if __name__=='__main__':main()
