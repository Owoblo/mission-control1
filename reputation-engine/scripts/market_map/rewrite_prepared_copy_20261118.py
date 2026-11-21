"""Bounded playbook-grounded copy revision of the existing queue; no sending."""
import datetime,fcntl,hashlib,json,os,re,sys
from pathlib import Path
ROOT=Path('/data/research');OUT=ROOT/'artifacts/partnership-enrichment-20261118';WORK=OUT/'copy-revision'
sys.path.insert(0,str(ROOT))
import scripts.market_map
scripts.market_map.__path__.insert(0,str(OUT/'lib'))
from scripts.market_map.site_research_runner import BudgetTransport
from scripts.market_map.site_research_ai import _object,STRING,STRINGS,_validate
from scripts.market_map.research_model_benchmark import estimated_cost,RATES

ROW=_object({k:STRING for k in ['key','subject','body','context_rationale','source_fact_used','cta_purpose']})
SCHEMA=_object({'messages':{'type':'array','items':ROW}})
def now():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def save(path,data):
 t=path.with_suffix(path.suffix+'.tmp');t.write_text(json.dumps(data,ensure_ascii=False,indent=2));t.replace(path)

def choose(item):
    if item.get('target_crm_contact_id'):
        recipient=item.get('proposed_recipient');return ('email'if recipient and '@'in recipient else 'sms',recipient)
    email=next((r['value']for r in item['routes']if r['type']=='email'),None)
    mobile=next((r['value']for r in item['routes']if r['type']=='phone'and r.get('technical_check',{}).get('type')=='mobile'),None)
    return ('email',email)if email else ('sms',mobile)if mobile else ('email',None)

def task(item):
    channel,to=choose(item);evidence=[]
    for route in item['routes']:
        for e in route.get('evidence',[])[:1]:evidence.append({k:e.get(k)for k in ['source_url','context']})
    touches=item.get('crm_review',{}).get('evidence',{}).get('touches',{}).get('rows',[])
    history=[{'direction':t.get('direction'),'at':t.get('created_at'),'text':t.get('notes','')[:2400]}for t in touches if t.get('direction')in('inbound','outbound')]
    return {'key':item['key'],'organization':item['organization'],'sector':item['sector_hypothesis'],'business_address':item['business_address'],'work_type':item['work_type'],'channel':channel,'recipient':to,'verified_greeting_name':'Sarah'if item['organization']=='Windsor-Essex Catholic District School Board'else None,'identity_hold':item.get('identity_review_condition'),'source_evidence':evidence[:3],'saved_history':history[:3],'instruction':'Missing recipient means prepare copy only and keep route hold. Do not guess an address or treat a fixed-line/mobile result as a texting route.'}

def validate_messages(parsed,tasks):
    _validate(parsed,SCHEMA);expected={t['key']:t for t in tasks};rows=parsed['messages']
    if len(rows)!=len(tasks)or {r['key']for r in rows}!=set(expected):raise ValueError('Response keys do not reconcile')
    for r in rows:
        t=expected[r['key']];body=r['body'].strip();words=len(body.split())
        if t['verified_greeting_name']:
            if not body.startswith('Hi '+t['verified_greeting_name']+','):raise ValueError('Verified personal greeting missing')
        elif not body.startswith('I wanted to'):raise ValueError('Unnamed opening must start directly with I wanted to')
        if not (25<=words<=190):raise ValueError('Copy length outside review bounds')
        if t['channel']=='sms'and (len(body)>800 or r['subject']):raise ValueError('SMS format invalid')
        if t['channel']=='email'and not r['subject'].strip():raise ValueError('Email subject missing')
        if t['work_type']=='new_relationship_review'and 'Saturn Star Movers'not in body:raise ValueError('New introduction missing company identity')
        if re.search(r'introduce John|John[’\x27]s contact|John at Saturn Star Movers serves',body):raise ValueError('Third-person John voice requires correction; write as John')
        if re.search(r'\b(?:guaranteed|discount|commission|free move|24/7|fully insured|bonded|we noticed|i noticed)\b',body,re.I):raise ValueError('Unsupported terms or surveillance phrasing')
        if not r['context_rationale']or not r['source_fact_used']or not r['cta_purpose']:raise ValueError('Missing copy reasoning')
    return rows

def main():
    WORK.mkdir(exist_ok=True);lock=(WORK/'worker.lock').open('a+b');fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    source=OUT/'prepared-outreach-queue.json';raw=source.read_bytes();queue=json.loads(raw);digest=hashlib.sha256(raw).hexdigest()
    tasks=[task(x)for x in queue['items']if x['status']=='copy_alignment_pending']
    if len(tasks)!=39:raise ValueError('Expected exactly 39 pending revisions, preserving five corrected previews')
    contract=json.loads((WORK/'playbook-context.json').read_text())
    status={'state':'running','pid':os.getpid(),'at':now(),'pending_revisions':39,'preserved_previews':5,'rewritten':0,'batches_complete':0,'max_api_attempts':8,'estimated_reservation_cap_usd':3,'messages_sent':0,'crm_mutations':0};save(WORK/'status.json',status)
    budget=BudgetTransport(ROOT,WORK,max_calls=8,concurrency=1,start_interval=1);allrows=[];reservations=[]
    try:
        for n,start in enumerate(range(0,len(tasks),5),1):
            if (OUT/'STOP').exists()or (WORK/'STOP').exists():raise RuntimeError('Operator STOP')
            group=tasks[start:start+5];request={'model':'gpt-5.4','store':False,'reasoning':{'effort':'low'},'max_output_tokens':5000,'input':[{'role':'developer','content':contract['instructions']+'\nPLAYBOOK/SENT COMPARISONS:\n'+json.dumps(contract['comparisons'],ensure_ascii=False)},{'role':'user','content':json.dumps({'tasks':group},ensure_ascii=False)}],'text':{'format':{'type':'json_schema','name':'prepared_copy_revision','strict':True,'schema':SCHEMA}}}
            reserve=len(json.dumps(request,ensure_ascii=False).encode())*RATES['gpt-5.4'][0]/1e6+5000*RATES['gpt-5.4'][2]/1e6
            if sum(reservations)+reserve>3:raise RuntimeError('Conservative cost reservation ceiling')
            reservations.append(reserve);save(WORK/'reservations.json',{'reserved_estimated_usd':sum(reservations),'requests':reservations,'invoice':'unknown'})
            receipt=WORK/f'batch-{n}.json'
            if receipt.exists():raise RuntimeError('Prior batch receipt exists; no automatic replay')
            save(receipt,{'state':'started_no_blind_retry','keys':[t['key']for t in group],'request_sha256':hashlib.sha256(json.dumps(request,sort_keys=True).encode()).hexdigest()})
            response=budget(request);save(WORK/f'batch-{n}-response.json',response)
            if response.get('status')!='completed':raise ValueError('Incomplete model output')
            text=''.join(c.get('text','')for o in response.get('output',[])for c in o.get('content',[])if c.get('type')=='output_text')
            parsed=json.loads(text);rows=validate_messages(parsed,group);allrows+=rows
            save(receipt,{'state':'copy_format_checks_passed','messages':rows,'usage':response.get('usage',{}),'estimated_token_usd':estimated_cost('gpt-5.4',response.get('usage',{})),'send_approved':False})
            status.update(rewritten=len(allrows),batches_complete=n,updated_at=now());save(WORK/'status.json',status)
        if hashlib.sha256(source.read_bytes()).hexdigest()!=digest:raise RuntimeError('Queue changed during revision; preserve output for manual reconciliation')
        bykey={x['key']:x for x in allrows};pendingroute=0
        for item in queue['items']:
            if item['key']not in bykey:continue
            row=bykey[item['key']];t=next(t for t in tasks if t['key']==item['key']);channel,to=t['channel'],t['recipient']
            body=row['body'].strip()
            if channel=='email':body+='\n\nJohn\nSaturn Star Movers\n226-887-0667\n\nIf you prefer no further emails from me, just reply and let me know.'
            item.update(draft=body,subject=row['subject']or None,proposed_channel=channel,proposed_recipient=to,copy_review_status='playbook_rewritten_pending_semantic_review',copy_context_rationale=row['context_rationale'],source_fact_used=row['source_fact_used'],cta_purpose=row['cta_purpose'],copy_playbook_refs=contract['source_refs'],status='rewritten_copy_review_required',send_ready=False,approved=False,scheduled=False)
            item['holds']=[h for h in item['holds']if h!='playbook_comparison_and_channel_specific_copy_required']+['rewritten_copy_semantic_review_required','release_time_history_and_channel_check_required']
            if not to:item['holds'].append('missing_email_route_no_address_inferred');pendingroute+=1
            if channel=='email':item['holds'].append('cold_email_paused')
        queue['summary'].update(coordinated_drafts=44,revised_drafts=44,copy_alignment_pending=0,model_rewritten_pending_semantic_review=39,preserved_corrected_previews=5,rewritten_drafts_missing_channel_route=pendingroute)
        queue['summary']['new_relationship_drafts']=sum(bool(x.get('draft'))and x['work_type']=='new_relationship_review'for x in queue['items'])
        queue['summary']['prior_outreach_followup_drafts']=sum(bool(x.get('draft'))and x['work_type']=='prior_outreach_followup_review'for x in queue['items'])
        queue['summary']['states']={s:sum(x['status']==s for x in queue['items'])for s in set(x['status']for x in queue['items'])}
        queue['copy_quality_hold']={'reason':'All 44 have revised copy; 39 newly generated require semantic/operator review. Technical/channel/identity holds remain.','send_release_enabled':False};queue['at']=now()
        save(OUT/'prepared-outreach-queue.json',queue);save(WORK/'rewritten-queue.json',queue)
        status.update(state='completed_pending_copy_review',finished_at=now(),rewritten=39,total_revised=44,missing_route=pendingroute,estimated_token_usd=sum(estimated_cost(r['model'],r.get('usage',{}))for r in budget.data.get('responses',[])),queue_sha256=hashlib.sha256((OUT/'prepared-outreach-queue.json').read_bytes()).hexdigest());save(WORK/'status.json',status)
    except Exception as exc:
        status.update(state='revision_hold',error_type=type(exc).__name__,error=str(exc)[:600],updated_at=now());save(WORK/'status.json',status);raise
if __name__=='__main__':main()
