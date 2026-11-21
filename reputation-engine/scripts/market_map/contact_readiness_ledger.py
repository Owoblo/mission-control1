"""Contact-level evidence and daily outcomes; never treats a channel as another person."""
import datetime,json,sqlite3,re
from pathlib import Path
from zoneinfo import ZoneInfo
EVENTS={'verified','queued','provider_accepted','delivered','human_reply','meeting','opportunity'}
class ContactLedger:
 def __init__(self,path):
  self.db=sqlite3.connect(path);self.db.row_factory=sqlite3.Row
  self.db.executescript('''
   CREATE TABLE IF NOT EXISTS contacts(contact_id TEXT PRIMARY KEY,account_id TEXT NOT NULL,kind TEXT NOT NULL,identity_state TEXT NOT NULL DEFAULT 'resolved');
   CREATE TABLE IF NOT EXISTS channels(channel TEXT NOT NULL,address TEXT NOT NULL,contact_id TEXT NOT NULL,PRIMARY KEY(channel,address));
   CREATE TABLE IF NOT EXISTS conflicts(channel TEXT,address TEXT,first_contact TEXT,second_contact TEXT,PRIMARY KEY(channel,address,first_contact,second_contact));
   CREATE TABLE IF NOT EXISTS events(event_key TEXT PRIMARY KEY,contact_id TEXT NOT NULL,event_type TEXT NOT NULL,channel TEXT,occurred_at TEXT NOT NULL,local_day TEXT NOT NULL,evidence TEXT NOT NULL);
  ''')
 def register(self,contact_id,account_id,kind,channels):
  if not contact_id or not account_id or kind not in ['person','business_route']:raise ValueError('Resolved CRM contact/account and explicit kind required')
  with self.db:
   old=self.db.execute('SELECT * FROM contacts WHERE contact_id=?',(contact_id,)).fetchone()
   if old and (old['account_id']!=account_id or old['kind']!=kind):raise ValueError('Identity change requires reconciliation')
   self.db.execute('INSERT OR IGNORE INTO contacts(contact_id,account_id,kind) VALUES(?,?,?)',(contact_id,account_id,kind))
   for channel,address in channels:
    if channel not in ['sms','email','phone','direct_mail','linkedin'] or not address:raise ValueError('Invalid channel identity')
    # Phone and SMS share one identity namespace.
    channel='phone' if channel=='sms' else channel
    address=address.strip().lower()
    if channel=='phone':
     if re.search(r'[a-z]',address):raise ValueError('Phone extensions require a separately resolved route')
     digits=re.sub(r'\D','',address)
     if len(digits)==10:digits='1'+digits
     if len(digits)!=11 or not digits.startswith('1'):raise ValueError('Expected North American phone identity')
     address='+'+digits
    previous=self.db.execute('SELECT contact_id FROM channels WHERE channel=? AND address=?',(channel,address)).fetchone()
    if previous and previous['contact_id']!=contact_id:
     self.db.execute('INSERT OR IGNORE INTO conflicts VALUES(?,?,?,?)',(channel,address,previous['contact_id'],contact_id))
     self.db.execute("UPDATE contacts SET identity_state='conflict' WHERE contact_id IN (?,?)",(contact_id,previous['contact_id']))
    else:self.db.execute('INSERT OR IGNORE INTO channels VALUES(?,?,?)',(channel,address,contact_id))
 def event(self,key,contact_id,event_type,channel,occurred_at,evidence):
  if event_type not in EVENTS or not key or not evidence:raise ValueError('Supported stage and evidence required')
  if not self.db.execute('SELECT 1 FROM contacts WHERE contact_id=?',(contact_id,)).fetchone():raise ValueError('Unknown identity')
  instant=datetime.datetime.fromisoformat(occurred_at.replace('Z','+00:00'))
  if instant.tzinfo is None:raise ValueError('Timestamp timezone required')
  day=instant.astimezone(ZoneInfo('America/Toronto')).date().isoformat();body=json.dumps(evidence,sort_keys=True)
  occurred_at=instant.astimezone(datetime.timezone.utc).isoformat()
  values=(key,contact_id,event_type,channel,occurred_at,day,body)
  old=self.db.execute('SELECT * FROM events WHERE event_key=?',(key,)).fetchone()
  if old and tuple(old)!=values:raise ValueError('Event key evidence changed')
  with self.db:self.db.execute('INSERT OR IGNORE INTO events VALUES(?,?,?,?,?,?,?)',values)
 def scorecard(self,day):
  counts={e:0 for e in EVENTS}
  for r in self.db.execute("SELECT e.event_type,count(DISTINCT e.contact_id) n FROM events e JOIN contacts c USING(contact_id) WHERE e.local_day=? AND c.identity_state='resolved' GROUP BY e.event_type",(day,)):counts[r['event_type']]=r['n']
  # Follow-ups and second-channel sends do not become new contacts.
  first=self.db.execute("SELECT count(*) FROM (SELECT e.contact_id,min(e.local_day) first_day FROM events e JOIN contacts c USING(contact_id) WHERE e.event_type='provider_accepted' AND c.identity_state='resolved' GROUP BY e.contact_id HAVING first_day=?)",(day,)).fetchone()[0]
  qualified=self.db.execute("WITH firsts AS (SELECT e.contact_id,min(e.occurred_at) first_at,min(e.local_day) first_day FROM events e JOIN contacts c USING(contact_id) WHERE e.event_type='provider_accepted' AND c.identity_state='resolved' GROUP BY e.contact_id), verified AS (SELECT contact_id,min(occurred_at) verified_at FROM events WHERE event_type='verified' GROUP BY contact_id) SELECT count(*) FROM firsts JOIN verified USING(contact_id) WHERE first_day=? AND verified_at<=first_at",(day,)).fetchone()[0]
  return {'day':day,'timezone':'America/Toronto','target_new_unique_contacts':1000,'stages':counts,'new_unique_contacts_provider_accepted':first,'identity_conflicts_excluded':self.db.execute("SELECT count(*) FROM contacts WHERE identity_state='conflict'").fetchone()[0],'new_verified_unique_contacts_provider_accepted':qualified,'target_achieved':qualified>=1000,'limits':['Provider acceptance is not delivery or inbox placement.','Counts cover only evidence imported into this ledger.','SMS and email to one resolved contact count once; unresolved aliases are excluded.']}
 def close(self):self.db.close()
