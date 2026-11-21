"""Read-only queue audit; writes recovery preparation artifacts, never changes holds."""
import argparse, collections, datetime, hashlib, json, sqlite3
from pathlib import Path

ROOT=Path('artifacts/partnership-pilot-3000-20261027')
def verdict(v,k):return v.get('Evaluations',{}).get(k,{}).get('ConfidenceVerdict')
def reason(v):
 if not v:return 'missing_validation'
 if verdict(v,'MailboxExists')=='LOW':return 'low_mailbox_confidence'
 if verdict(v,'IsRandomInput')=='HIGH' or verdict(v,'IsDisposable')=='HIGH':return 'random_or_disposable_high'
 if verdict(v,'HasValidSyntax')!='HIGH':return 'syntax_uncertain'
 if verdict(v,'HasValidDnsRecords')=='LOW':return 'dns_low'
 if verdict(v,'HasValidDnsRecords')!='HIGH':return 'dns_uncertain'
 if verdict(v,'IsRandomInput')!='LOW' or verdict(v,'IsDisposable')!='LOW':return 'random_or_disposable_uncertain'
 if v.get('IsValid',{}).get('ConfidenceVerdict')!='HIGH':return 'overall_not_high_other_checks_clear'
 return 'high_validation_technical_hold_needs_reconcile'
def age_hours(stamp,now):
 try:return (now-datetime.datetime.fromisoformat(stamp.replace('Z','+00:00'))).total_seconds()/3600
 except (TypeError,ValueError,AttributeError):return None

def main():
 ap=argparse.ArgumentParser();ap.add_argument('--root',type=Path,default=ROOT);a=ap.parse_args();root=a.root
 db=sqlite3.connect('file:'+str(root/'review-workqueue.sqlite3')+'?mode=ro',uri=True)
 now=datetime.datetime.now(datetime.timezone.utc);out=root/'technical-recovery-audit';out.mkdir(exist_ok=True)
 groups=collections.defaultdict(list);technical=[];ottawa=[]
 for oid,state,payload in db.execute("SELECT organisation_id,state,snapshot FROM items WHERE state IN ('technical_hold','sender_hold') ORDER BY organisation_id"):
  s=json.loads(payload);c=s['candidate'];v=s['validation'];source=s['source']
  group='ottawa_adapter_required' if state=='sender_hold' else reason(v.get('validation',{}))
  item={'organisation_id':oid,'organisation_name':c['organisation_name'],'email':c['email'],'domain':c['domain'],'mail_domain':c['email'].rsplit('@',1)[-1].lower(),'city':c['city'],'hold_state':state,'recovery_group':group,'validation_age_hours':age_hours(v.get('checked_at'),now),'source_age_hours':age_hours(source.get('checked_at'),now),'target_email_observed':source.get('target_email_observed',False),'restriction_signal_count':len(source.get('restriction_signals',[])),'alternate_published_addresses':source.get('alternate_published_addresses',[]),'candidate':c,'validation':v,'technical':s['technical'],'source_snapshot_hash':hashlib.sha256(json.dumps(source,sort_keys=True).encode()).hexdigest(),'campaign_ready':False}
  groups[group].append(item);(ottawa if state=='sender_hold' else technical).append(item)
 for name,rows in groups.items():(out/(name+'.jsonl')).write_text(''.join(json.dumps(r)+'\n' for r in rows))
 dns=[r for name in ['dns_low','dns_uncertain','syntax_uncertain'] for r in groups[name]]
 (out/'dns-recovery-domains.json').write_text(json.dumps(sorted({r['mail_domain'] for r in dns}),indent=2)+'\n')
 summary={'at':now.isoformat(),'mode':'read_only_hold_audit','counts':{k:len(v) for k,v in groups.items()},'technical_total':len(technical),'ottawa_total':len(ottawa),'technical_stale_validation':sum(r['validation_age_hours'] is None or r['validation_age_hours']>24 for r in technical),'technical_stale_source':sum(r['source_age_hours'] is None or r['source_age_hours']>24 for r in technical),'technical_missing_validation':sum(not r['validation'].get('validation') for r in technical),'technical_publication_observed':sum(r['target_email_observed'] for r in technical),'technical_with_restriction_signals':sum(r['restriction_signal_count']>0 for r in technical),'technical_with_other_published_addresses':sum(any(e.lower()!=r['email'].lower() for e in r['alternate_published_addresses']) for r in technical),'ottawa_stale_validation':sum(r['validation_age_hours'] is None or r['validation_age_hours']>24 for r in ottawa),'ottawa_stale_source':sum(r['source_age_hours'] is None or r['source_age_hours']>24 for r in ottawa),'dns_domains_prepared':len({r['mail_domain'] for r in dns}),'admitted':0,'sent':0,'paid_validation_calls':0,'notes':['LOW mailbox verdict is adverse confidence, not a witnessed SMTP failure or confirmed bounce.','1278 clean-other-checks MEDIUM-overall rows must remain held until independently verified HIGH; generic role addresses are not automatically disqualified.','Fresh DNS checks are preparatory evidence only and do not upgrade mailbox validation.','Ottawa records still need individual source/role/context review and a canonical provider adapter before admission.','Original evidence, queue states and explicit hold history remain unchanged.']}
 (out/'summary.json').write_text(json.dumps(summary,indent=2)+'\n');print(json.dumps(summary,indent=2))
if __name__=='__main__':main()
