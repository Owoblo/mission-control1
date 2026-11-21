"""Freeze research supply beyond the original pilot; no mailbox or sending claims."""
import csv,hashlib,json,collections
from pathlib import Path
from datetime import datetime,timezone

def main():
 root=Path(__file__).resolve().parents[2]
 pilot=root/'artifacts/partnership-pilot-3000-20261027'
 cohort=root/'partnership-system/exports/cohort-20000/research-cohort.csv'
 out=root/'artifacts/partnership-next-day-research-20261028';out.mkdir(exist_ok=True)
 if (out/'candidates.json').exists():
  print((out/'manifest.json').read_text());return
 prior=json.loads((pilot/'candidates.json').read_text());ids={r['organisation_id'] for r in prior};emails={r['email'].lower() for r in prior}
 buckets=collections.defaultdict(list)
 with cohort.open(encoding='utf-8-sig',newline='') as f:
  for row in csv.DictReader(f):
   if row['organisation_id'] in ids or row['email'].lower() in emails:continue
   row.update(campaign_ready=False,verification_status='pending',contact_binding='unverified',outreach_eligibility='not_assessed',research_source=str(cohort.relative_to(root)))
   buckets[(row['city'],row['sector'])].append(row)
 rows=[]
 while buckets:
  for k in sorted(list(buckets)):
   row=buckets[k].pop(0)
   if row['organisation_id'] not in ids and row['email'].lower() not in emails:
    rows.append(row);ids.add(row['organisation_id']);emails.add(row['email'].lower())
   if not buckets[k]:del buckets[k]
 body=json.dumps(rows,ensure_ascii=False,indent=2)
 (out/'candidates.json').write_text(body)
 manifest={'created_at':datetime.now(timezone.utc).isoformat(),'research_candidates':len(rows),'original_pilot_excluded':len(prior),'cities':len({r['city'] for r in rows}),'sector_labels':len({r['sector'] for r in rows}),'campaign_ready':0,'sha256':hashlib.sha256(body.encode()).hexdigest(),'cohort_sha256':hashlib.sha256(cohort.read_bytes()).hexdigest(),'limits':['Upstream cohort has one candidate per domain and can underrepresent franchises. This step preserves its provenance; it does not claim exhaustive branch coverage.','No admission, send or mailbox validation performed.','Physical location and named-role association remain unverified provider claims.']}
 (out/'manifest.json').write_text(json.dumps(manifest,indent=2));print(json.dumps(manifest))

if __name__=='__main__':main()
