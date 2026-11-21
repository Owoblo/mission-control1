"""Recheck saved regional website receipts; no requests, AI calls or CRM writes."""
import argparse
import csv
import fcntl
import hashlib
import json
from pathlib import Path
from .email_extraction import VERSION, extract_published_emails


def recheck(root, output):
    root=Path(root).resolve(); output=Path(output);output.mkdir(parents=True,exist_ok=True)
    lock=(output/'run.lock').open('a');fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    receipts=list((root/'sources').glob('*/receipt.json')); baseline=set(); pages=[]; gaps=[]
    for path in receipts:
        try:
            receipt=json.loads(path.read_text())
            for page in receipt.get('pages',[]):
                baseline.update(r['email'].casefold() for r in page.get('emails',[]) if r.get('email'))
                pages.append((path,receipt,page))
        except (ValueError,OSError) as exc:gaps.append({'source_url':str(path),'reason':type(exc).__name__})
    rows=[]; seen=set(); parsed=0;checked=0
    def progress():
        temp=output/'status.json.tmp'
        temp.write_text(json.dumps(dict(state='running',extraction_version=VERSION,receipts_checked=len(receipts),pages_in_receipts=len(pages),pages_checked=checked,pages_reparsed=parsed,coverage_gaps=len(gaps),network_requests=0,model_calls=0,crm_writes=0,messages_sent=0)))
        temp.replace(output/'status.json')
    progress()
    for receipt_path,receipt,page in pages:
        try:
            path=Path(page['body_path']).resolve()
            if root not in path.parents:raise ValueError('Source path outside capture folder')
            if path.stat().st_size>3_000_000:raise ValueError('Saved source exceeds 3MB limit')
            raw=path.read_bytes();digest=hashlib.sha256(raw).hexdigest()
            if digest!=page.get('sha256'):raise ValueError('Source hash mismatch')
            if raw.lstrip().startswith((b'%PDF',b'PK\x03\x04',b'\x89PNG',b'\xff\xd8',b'\x1f\x8b')) or b'\x00' in raw[:4096]:
                raise ValueError('Non-HTML document needs separate extraction')
            findings=extract_published_emails(raw,page['url']);parsed+=1
            for r in findings:
                key=(r['email'],r['source_url'])
                if key in seen:continue
                seen.add(key)
                rows.append(dict(email=r['email'],source_url=r['source_url'],source_sha256=digest,
                    extraction_methods=' | '.join(r['extraction_methods']),extraction_version=VERSION,
                    new_vs_receipt_baseline=str(r['email'].casefold() not in baseline).lower(),
                    publishing_domain=receipt.get('host',''),
                    candidate_city_context=' | '.join(sorted({x.get('municipality','') for x in receipt.get('records',[]) if x.get('municipality')})),
                    association_status=r['association_status'],mailbox_status='not_checked',outreach_eligibility='research_only'))
        except (OSError,ValueError,KeyError) as exc:gaps.append({'source_url':page.get('url',''),'reason':str(exc)[:240]})
        checked+=1
        if checked%100==0:progress()
    fields=['email','source_url','source_sha256','extraction_methods','extraction_version','new_vs_receipt_baseline','publishing_domain','candidate_city_context','association_status','mailbox_status','outreach_eligibility']
    rows.sort(key=lambda r:(r['email'],r['source_url']))
    for name,data,columns in [('all-email-evidence.csv',rows,fields),('new-email-evidence.csv',[r for r in rows if r['new_vs_receipt_baseline']=='true'],fields),('coverage-gaps.csv',gaps,['source_url','reason'])]:
        with (output/name).open('w') as f:
            w=csv.DictWriter(f,fieldnames=columns);w.writeheader();w.writerows(data)
    addresses={r['email'].casefold() for r in rows}
    status=dict(state='completed',extraction_version=VERSION,receipts_checked=len(receipts),pages_in_receipts=len(pages),
                pages_reparsed=parsed,coverage_gaps=len(gaps),baseline_unique_emails=len(baseline),
                recovered_unique_emails=len(addresses),additional_unique_emails=len(addresses-baseline),
                network_requests=0,model_calls=0,crm_writes=0,messages_sent=0)
    (output/'status.json').write_text(json.dumps(status,indent=2)+'\n');lock.close();return status


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--root',required=True);p.add_argument('--output',required=True);a=p.parse_args()
    print(json.dumps(recheck(a.root,a.output),indent=2))
