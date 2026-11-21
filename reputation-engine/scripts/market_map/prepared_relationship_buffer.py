"""Evidence-bound preparation ledger. No sender, provider lookup or paid research."""
import hashlib,json,re,sqlite3
from collections import Counter
from datetime import datetime,timedelta,timezone
from email.utils import parseaddr
from pathlib import Path
from zoneinfo import ZoneInfo

VERSION='relationship-preparation/3'
def stamp():return datetime.now(timezone.utc).isoformat()
def digest(value):return hashlib.sha256(json.dumps(value,sort_keys=True,ensure_ascii=False).encode()).hexdigest()
def text(t):return re.sub(r'^Inbound SMS:\s*','',str(t.get('notes')or''),flags=re.I).strip()
def dt(v):
 value=v.replace('Z','+00:00');value=re.sub(r'\.(\d+)(?=[+-]\d{2}:\d{2}$)',lambda m:'.'+(m[1]+'000000')[:6],value);return datetime.fromisoformat(value)
def first_name(name):return str(name or '').split()[0].capitalize()
def card_url(city):
 paths=[Path(__file__).with_name('card-catalog.json'),Path(__file__).resolve().parents[2]/'lib/data/partner-business-cards.json']
 catalog=next((json.loads(p.read_text())for p in paths if p.exists()),[]);matches=[r for r in catalog if r['city'].casefold()==city.casefold()]
 if len(matches)!=1 or matches[0]['business']!='Saturn Star Movers':return None
 row=matches[0];version='2026-09-26-gta-sold2move-v2'if row['region']=='toronto'else '2026-09-10'
 return f"https://idbyrtwdeeruiutoukct.supabase.co/storage/v1/object/public/ops-media/partnership-library/business-cards/{version}/{row['slug']}/card.jpg"
def card_permission(combined):
 if re.search(r"\bno (?:thanks|thank you|need|longer)|don.t|do not|not interested|[?]|\b(?:price|rate|cost|insurance|reference|where|when|how)\b",combined,re.I):return False
 return bool(re.search(r'\b(?:yes|sure|ok|okay|absolutely|yeah|sounds good)\b|send it|send.{0,20}card',combined,re.I))
def next_business_window(now):
 local=now.astimezone(ZoneInfo('America/Toronto'));day=local.date()+timedelta(days=1)
 while day.weekday()>4:day+=timedelta(days=1)
 return datetime.combine(day,datetime.min.time().replace(hour=9,minute=30),local.tzinfo).astimezone(timezone.utc)

# Explicit operator-reviewed identities; bodies still require live channel/history checks.
CARD_NAMES={'00925043-edb9-464a-83fb-01787ac208ed':'Dave','5f14e307-79b1-442a-b81c-91e6551a58c8':'Izabella','51e19d3b-d684-4b08-81fc-774e9636d1dd':'Rosanne','8609c59d-2c46-47be-ae18-26079cbdd501':'Gary','8c0cbaed-2ab5-4c6b-ab0b-91df3daffb6d':'Prem','9ff204ca-c4be-4da0-961b-d52b07439227':'Haroon','f0b2e956-2998-45d4-8eea-bd2dec449a63':'Samantha','68893e56-8f68-44da-9752-4e0266912888':'Jenn','30267b2d-fb7c-42b6-9411-bbb2e7fc7ec3':'Raja','a1c500b5-8311-41d8-aaa4-d93538ed1adf':'Minh','0f5e0d0c-130b-49b0-a1a1-af90e5793aeb':'Dave','67dc1e2a-498e-4d0e-90da-ca8cb81b5639':'Sanjiv','a432afa5-9258-4f83-ad6b-83ddeb23d945':'Emily','06b46a7b-7640-4d9a-b8a7-2ebb27e0c148':'Andy','05042033-6829-449a-8b49-dc9b9834dda1':'Tina','3edd13b0-5dcb-481e-b701-a70cb0589d81':'Yvonne'}
PLAYBOOK=['docs/partnership-relationship-playbook.md','docs/partnership-faq-and-concerns.md','docs/partnership-prepared-pipeline-20261118.md','docs/email-channel-policy-20261109.md']

def relationship_action(record,now):
 c=record.get('contact')or{};history=sorted(record.get('history',[]),key=lambda t:(dt(t['created_at']),t['id']));last=history[-1]if history else {};body=text(last);m=last.get('metadata')or{}
 outbound=next((t for t in reversed(history)if t['direction']=='outbound'and not text(t).startswith('SES event:')),None)
 after=[t for t in history if t['direction']=='inbound'and(not outbound or dt(t['created_at'])>=dt(outbound['created_at']))];combined='\n'.join(text(t)for t in after)
 route=m.get('to')or m.get('to_number')or((outbound or{}).get('metadata')or{}).get('from');kind='context_review';priority=60;reason='Full context remains unresolved; retain without inventing a request.';draft=None;channel=None;recipient=None;sender=None;media=[];holds=['operator_context_review','release_time_cross_channel_history_and_suppression_recheck'];not_before=now;owner='John'
 if c.get('do_not_contact')or c.get('cross_channel_suppressed_at')or c.get('decision')in ['bad_number','rejected','opted_out']or c.get('stage')=='dnc':
  kind='suppression_hold';priority=99;reason='Current contact/route suppression prevents preparation for sending.'
 elif str(route or'').endswith('6581'):
  kind='operations_excluded';priority=99;reason='Dedicated operations/subcontractor route is excluded.'
 elif last.get('direction')!='inbound' or (m.get('partnership_review')or{}).get('reply_required')is False:
  kind='already_handled';priority=99;reason='Latest context already has an outbound response or an explicit contextual review.'
 elif re.search(r'^SES event:|^(Liked|Loved|Reacted|Laughed at)\b|^赞了|^â|ð\x9f',body,re.I):
  kind='system_or_reaction';priority=99;reason='Event or reaction wrapper; quoted copy is not a new request.'
 elif record.get('classification')=='call_context_review' or last.get('channel')=='phone':
  kind='call_context_review';priority=30;reason='Reconcile actual call and Sales outcome before proposing a reply.'
 elif re.search(r'never showed|no.show|refund|damage|complaint|second time.{0,30}appointment',combined,re.I):
  kind='owner_exception';priority=0;reason='Complaint, missed visit or financial commitment requires owner context.'
 elif re.search(r'\bMOU\b|esign|e.sign|\$1000|referral fee|commission|discount|references?|Blinq|AI\?',combined,re.I):
  kind='owner_terms_or_reference_review';priority=10;reason='Owner must verify references, contract/commercial terms or requested personal response.'
 elif c.get('id')in CARD_NAMES and card_permission(combined)and outbound and re.search(r'would you like a digital card',text(outbound),re.I)and 'Saturn Star Movers'in text(outbound)and 'John'in text(outbound):
  kind='requested_card_fulfilment';priority=5;reason='Operator reviewed affirmative response to the specific digital-card offer; no later saved fulfilment.';channel='sms';recipient=c.get('phone');sender=route;not_before=next_business_window(now)
  name=CARD_NAMES[c['id']];city=c.get('city')or''
  draft=f"Here's our {city} card, {name}. Sorry I missed your earlier request. You can save it or pass it along whenever a client needs moving help. - John"
  asset=card_url(city);media=[asset]if asset else [];holds.append('asset_catalog_match_required')if not asset else None
  holds=['operator_release_approval','fresh_carrier_and_recipient_identity_review','asset_content_and_url_verification','current_provider_sales_and_pending_job_check','release_time_cross_channel_history_and_suppression_recheck']
 elif c.get('id')=='f59eaa3d-a5f9-4a99-a06e-952068bf2860':
  kind='requested_email_fulfilment';priority=5;reason='Jasmyn explicitly requested the digital card by email; preserve original authorized mailbox/thread.';channel='email';recipient=c.get('email');sender=parseaddr(((outbound or{}).get('metadata')or{}).get('from',''))[1];not_before=next_business_window(now)
  draft="Hi Jasmyn,\n\nThank you for your message, and sorry I missed your request earlier. Here's our Brantford digital card to keep on hand or share when moving help comes up.\n\nYou can reach me on 437-465-0584. I'd be glad to discuss any office furniture or business moving needs with your team.\n\nJohn\nSaturn Star Movers"
  media=[card_url('Brantford')]if card_url('Brantford')else [];holds=['original_sender_and_human_thread_confirmation','email_reply_workflow_disabled','asset_content_and_url_verification','release_time_cross_channel_history_and_suppression_recheck']
 elif c.get('id')=='2ecb2b14-8bf6-45c7-a943-b3c199c8ceb3':
  kind='requested_email_fulfilment';priority=5;reason='Rob offered a website recommendation and requested company name/phone confirmation; no fee or current move was proposed.';channel='email';recipient=c.get('email');sender=parseaddr(((outbound or{}).get('metadata')or{}).get('from',''))[1];not_before=next_business_window(now)
  draft="Hi Rob,\n\nThank you for offering to include us, and sorry I missed your message earlier. You're welcome to list Saturn Star Movers in your recommendations.\n\nBusiness name: Saturn Star Movers\nPhone: 437-465-0584\nWebsite: https://starmovers.ca\n\nI appreciate you keeping us in mind.\n\nJohn\nSaturn Star Movers";holds=['original_sender_and_human_thread_confirmation','email_reply_workflow_disabled','release_time_cross_channel_history_and_suppression_recheck']
 elif re.search(r'please.{0,30}call|my (?:own |iwn )?(?:move|frig|fridge)|quote the price|pickup\s*:|delivery\s*:|one tenant moves out',combined,re.I):
  kind='sales_history_review';priority=15;owner='Thelma Ufot';reason='Specific historical moving scope exists; check current Sales ownership/outcome rather than invent a fresh job or repeat intake.'
 elif re.search(r'meet|coffee|office tomorrow|Tuesday|Wednesday|swinging by|stop by',combined,re.I)or (outbound and re.search(r'(?:drop|stop).{0,12}(?:by|off)',text(outbound),re.I)and re.search(r'yes|sure|sounds good|absolutely',combined,re.I)):
  kind='owner_meeting_review';priority=10;reason='Meeting, visit or timing context requires owner confirmation; no automatic scheduling or old-date revival.'
 elif re.search(r'no thanks|no thank you|not interested|do not contact|don.t contact|stop texting',combined,re.I):
  kind='decline_review';priority=98;reason='Recipient declined; retain history and verify suppression scope before any future outreach.'
 elif re.search(r'WhatsApp|wgatsapp|email me|not located|not.*(?:office|agent)|practice in|my office is|does not.{0,20}text|recieve text',combined,re.I):
  kind='channel_or_geography_review';priority=35;reason='Explicit channel/location/role information needs reconciliation, not inferred preference or a new address.'
 elif '?'in combined or re.search(r'\b(?:send|please|could you|can you|how|where|what|who|invoice|insurance|quote|price|rate)\b',combined,re.I):
  kind='specific_request_context_review';priority=25;reason='Specific question or request remains; do not classify as quiet merely because the message also says thanks.'
 elif re.search(r'no one|nothing|not right now|not at (?:this|the)|no clients|don.t have any|keep.{0,25}(?:mind|contact|file)|saved your|thank|thanks|not yet|for now|nope',combined,re.I):
  kind='quiet_relationship_review';priority=80;reason='Quiet/no-current-need or acknowledgement context; no automatic follow-up or client/job inference.'
  not_before=max(now,dt(last['created_at'])+timedelta(days=60))
  if re.search(r'next year|new year',combined,re.I):not_before=max(not_before,datetime(now.year+1,1,1,tzinfo=ZoneInfo('America/Toronto')).astimezone(timezone.utc))
 elif re.fullmatch(r'\W*(?:yes|sure|ok|okay|absolutely|sounds good)\W*',body,re.I):
  kind='ambiguous_affirmation_review';priority=50;reason='Short affirmative without operator-confirmed material context; do not manufacture a visit, package or live move.'
 source={'policy_version':VERSION,'contact_id':c.get('id'),'latest_touch':{k:last.get(k)for k in ['id','created_at','direction','notes']},'request_window':[{k:t.get(k)for k in ['id','created_at','notes']}for t in after],'preceding_outbound':{k:(outbound or{}).get(k)for k in ['id','created_at','notes']},'suppression':{k:c.get(k)for k in ['phone','email','do_not_contact','cross_channel_suppressed_at','decision','stage','preferred_channel']}}
 return {'key':'crm:'+str(c.get('id')),'source':'conversation_review','contact_id':c.get('id'),'name':c.get('name'),'city':c.get('city'),'category':'existing_relationship','kind':kind,'priority':priority,'state':'draft_prepared_hold'if draft else kind,'channel':channel,'recipient':recipient,'sender':sender,'body':draft,'media_urls':media,'subject':'Re: Working with '+(c.get('company')or c.get('name')or'')if channel=='email'else None,'reason':reason,'owner':owner,'not_before':not_before.isoformat(),'expires_at':(max(now,not_before)+timedelta(days=7)).isoformat()if draft else None,'source_fingerprint':digest(source),'source_touch_ids':[t['id']for t in history],'latest_touch_id':last.get('id'),'last_inbound_literal':body,'evidence':source,'open_task_ids':[t['id']for t in record.get('tasks',[])],'holds':holds,'playbook_refs':PLAYBOOK,'draft_reviewed':bool(draft),'approved':False,'scheduled':False,'send_ready':False}

def research_action(item,source,now):
 preview=item.get('corrected_preview')or{};draft=item.get('draft');body=draft.get('body')if isinstance(draft,dict)else draft
 address=item.get('business_address')or item.get('address')or'';locality=re.search(r'\b(Windsor|Tecumseh|Toronto|LaSalle|Lakeshore|Chatham-Kent)\b',address,re.I);city=item.get('city')or(locality[1]if locality else None)
 channel=preview.get('channel')or item.get('proposed_channel');recipient=preview.get('to')or item.get('proposed_recipient');key=item.get('key')or item.get('id');contact=item.get('target_crm_contact_id')
 if body is None:kind='research_debt'
 elif item.get('work_type')=='prior_outreach_followup_review':kind='prior_outreach_followup'
 else:kind='new_relationship'
 holds=list(item.get('holds',[]));holds+=['release_time_cross_channel_history_and_suppression_recheck','operator_release_approval']
 if channel=='email':holds.append('cold_email_paused')
 if not recipient:holds.append('selected_channel_route_unresolved')
 return {'key':'crm:'+contact if contact else source+':'+str(key),'source':source,'contact_id':contact,'name':item.get('organization'),'city':city,'category':item.get('sector_hypothesis')or item.get('category'),'kind':kind,'priority':40 if body else 70,'state':'draft_prepared_hold'if body else 'research_debt','channel':channel,'recipient':recipient,'sender':None,'body':body,'subject':item.get('subject')or(draft or{}).get('subject')if isinstance(draft,dict)else item.get('subject'),'media_urls':[],'reason':item.get('copy_context_rationale')or item.get('context_summary')or 'Existing sourced research packet; do not regenerate its reviewed copy.','owner':item.get('owner')or'John','not_before':next_business_window(now).isoformat(),'expires_at':(now+timedelta(days=7)).isoformat()if body else None,'source_fingerprint':digest({'policy_version':VERSION,'source':source,'key':key,'body':body,'recipient':recipient,'channel':channel,'city':city,'holds':holds}),'holds':list(dict.fromkeys(holds)),'source_refs':item.get('source_pages_reviewed')or[r['source_url']for r in item.get('routes',[])],'draft_reviewed':bool(body),'approved':False,'scheduled':False,'send_ready':False}

def build(context,legacy,daily,now,sales=None):
 try:
  from .relationship_coordination import coordinate
 except ImportError:
  from relationship_coordination import coordinate
 records=context['priority_review'];rows=[coordinate(relationship_action(r,now),r,[],now)for r in records];dispositions=[{'key':r['key'],'contact_id':r['contact_id'],'kind':r['kind'],'priority':r['priority'],'has_draft':bool(r['body']),'latest_touch_id':r['latest_touch_id'],'reason':r['reason']}for r in rows]
 assert len(records)==len(dispositions)==len({r['key']for r in rows})
 rows +=[research_action(r,'legacy_cohort',now)for r in legacy['items']]+[research_action(r,'daily_cohort',now)for r in daily['items']]
 existing_routes={}
 for record in records+context.get('retained_review_dispositions',[]):
  contact=record.get('contact')or{}
  for channel,value in [('sms',contact.get('phone')),('email',contact.get('email'))]:
   if value:existing_routes.setdefault((channel,value.lower()),[]).append(contact['id'])
 for row in rows:
  match=existing_routes.get((row.get('channel'),str(row.get('recipient')or'').lower()),[])
  if row['source']!='conversation_review'and row.get('body')and match:
   row['holds'].append('existing_relationship_context_before_new_intro');row['existing_contact_candidates']=match;row['source_fingerprint']=digest({'original':row['source_fingerprint'],'existing_contacts':match})
 grouped={};aliases=[]
 for r in rows:
  if r['key']in grouped:
   aliases.append({'key':r['key'],'source':r['source'],'reason':'Existing CRM relationship has one primary action; research remains supporting evidence.'});continue
  grouped[r['key']]=r
 sales_counts=None
 if sales is not None:
  try:
   from .sales_relationship_signals import add_sales_evidence
  except ImportError:
   from sales_relationship_signals import add_sales_evidence
  counts,people=add_sales_evidence(grouped,*sales,context.get('outstanding_relationship_tasks',[]),now)
  sales_counts={'relationship_groups':people,**counts}
 routes={}
 for r in grouped.values():
  if r.get('body')and r.get('recipient'):routes.setdefault((r['channel'],r['recipient'].lower()),[]).append(r)
 for same in routes.values():
  if len(same)>1:
   for r in same:
    r['holds']=list(dict.fromkeys(r['holds']+['shared_recipient_account_coordination_review']));r['source_fingerprint']=digest({'original':r['source_fingerprint'],'shared_route_keys':sorted(x['key']for x in same)})
 ordered=sorted(grouped.values(),key=lambda r:(r['priority'],r.get('city')or'',r['key']))
 summary={'source_review_records':len(records),'classified_review_records':len(dispositions),'review_dispositions':dict(Counter(r['kind']for r in dispositions)),'actions':len(ordered),'drafts':sum(bool(r['body'])for r in ordered),'drafts_by_source':dict(Counter(r['source']for r in ordered if r['body'])),'drafts_by_channel':dict(Counter(r['channel']or'unresolved'for r in ordered if r['body'])),'draft_cities':{},'retained_nonhuman_or_reviewed':len(context.get('retained_review_dispositions',[])),'open_task_records':len(context.get('outstanding_relationship_tasks',[])),'eligible':0,'scheduled':0,'sent':0,'paid_model_calls':0}
 summary['draft_cities']=dict(Counter(r.get('city')or'not_recorded'for r in ordered if r['body']))
 if sales_counts is not None:summary['sales_relationship_signals']=sales_counts
 return {'at':now.isoformat(),'version':VERSION,'scope':'Preparation ledger only; source account records are not asserted unique people or qualified leads. Sending disabled.','summary':summary,'items':ordered,'review_dispositions':dispositions,'coordinated_aliases':aliases,'outstanding_tasks':context.get('outstanding_relationship_tasks',[]),'retained_dispositions':context.get('retained_review_dispositions',[])}

class Buffer:
 def __init__(self,path):
  self.db=sqlite3.connect(path,timeout=30);self.db.execute('PRAGMA journal_mode=WAL');self.db.executescript('CREATE TABLE IF NOT EXISTS actions(key TEXT PRIMARY KEY,fingerprint TEXT,payload TEXT,updated TEXT);CREATE TABLE IF NOT EXISTS versions(key TEXT,fingerprint TEXT,payload TEXT,at TEXT,PRIMARY KEY(key,fingerprint));CREATE TABLE IF NOT EXISTS runs(at TEXT PRIMARY KEY,summary TEXT);')
 def save(self,packet):
  changes=Counter()
  with self.db:
   for r in packet['items']:
    old=self.db.execute('SELECT fingerprint,payload FROM actions WHERE key=?',(r['key'],)).fetchone();body=json.dumps(r,ensure_ascii=False)
    if old and old[0]==r['source_fingerprint']:
     previous=json.loads(old[1])
     if previous.get('state')=='source_revalidation_required':
      previous=r.copy()
     elif 'sales_signal_evidence'in r:
      previous['sales_signal_evidence']=r['sales_signal_evidence']
     else:
      previous.pop('sales_signal_evidence',None)
     updated=json.dumps(previous,ensure_ascii=False)
     if updated!=old[1]:
      self.db.execute('UPDATE actions SET payload=?,updated=? WHERE key=?',(updated,stamp(),r['key']));changes['evidence_updated']+=1
     else:changes['unchanged']+=1
     r.clear();r.update(previous);continue
    if old:self.db.execute('INSERT OR IGNORE INTO versions VALUES(?,?,?,?)',(r['key'],old[0],old[1],stamp()));changes['changed']+=1
    else:changes['new']+=1
    self.db.execute('INSERT OR REPLACE INTO actions VALUES(?,?,?,?)',(r['key'],r['source_fingerprint'],body,stamp()))
   keys={r['key']for r in packet['items']};inactive=[]
   for key,fp,body in self.db.execute('SELECT key,fingerprint,payload FROM actions').fetchall():
    if key in keys:continue
    previous=json.loads(body)
    if previous.get('state')!='source_revalidation_required':
     self.db.execute('INSERT OR IGNORE INTO versions VALUES(?,?,?,?)',(key,fp,body,stamp()));previous.update(state='source_revalidation_required',approved=False,scheduled=False,send_ready=False);previous['holds']=list(dict.fromkeys(previous['holds']+['source_no_longer_active_reconcile_before_reuse']));self.db.execute('UPDATE actions SET payload=?,updated=?WHERE key=?',(json.dumps(previous,ensure_ascii=False),stamp(),key));changes['retired_to_review']+=1
    inactive.append({'key':key,'state':'source_revalidation_required'})
   packet['inactive_actions']=inactive
   self.db.execute('INSERT OR REPLACE INTO runs VALUES(?,?)',(packet['at'],json.dumps(packet['summary'])))
  return dict(changes)

def save_json(path,value):
 path.parent.mkdir(parents=True,exist_ok=True);tmp=path.with_suffix(path.suffix+'.tmp');tmp.write_text(json.dumps(value,ensure_ascii=False,indent=2));tmp.replace(path)

if __name__=='__main__':
 import argparse
 p=argparse.ArgumentParser();p.add_argument('--context',required=True);p.add_argument('--legacy',required=True);p.add_argument('--daily',required=True);p.add_argument('--out',required=True);args=p.parse_args();out=Path(args.out);out.mkdir(parents=True,exist_ok=True)
 packet=build(*[json.loads(Path(x).read_text())for x in [args.context,args.legacy,args.daily]],datetime.now(timezone.utc));db=Buffer(out/'prepared-actions.sqlite');packet['ledger_changes']=db.save(packet);db.db.close();save_json(out/'prepared-actions.json',packet);print(json.dumps(packet['summary'],indent=2))
