import json, html
from datetime import datetime
from zoneinfo import ZoneInfo
from pathlib import Path
from docx import Document
from docx.shared import Inches, Pt

P=Path('artifacts/all-sales-audit-20261016')
read=lambda name:json.loads((P/(name+'.json')).read_text())
doc=Document()
section=doc.sections[0]
section.header.paragraphs[0].text='SATURN STAR MOVERS • INTERNAL SALES OPERATIONS'
section.footer.paragraphs[0].text='Internal customer information. Read the live CRM conversation before taking action.'
doc.styles['Normal'].font.name='Calibri';doc.styles['Normal'].font.size=Pt(11)
parts=[]
def heading(text,level=1):
    doc.add_heading(text,level);parts.append(f'<h{level}>{html.escape(text)}</h{level}>')
def paragraph(text):
    doc.add_paragraph(text);parts.append('<p>'+html.escape(text)+'</p>')
def bullet(text):
    doc.add_paragraph(text,style='List Bullet');parts.append('<p>• '+html.escape(text)+'</p>')
heading('Sales: own the next step',0)
paragraph('Team briefing • October 16, 2026 • Prepared for John, Thelma and Ommy')
paragraph('Purpose: respond quickly, follow up persistently and keep every genuine customer accounted for. This is an operating standard and a reviewed work list, not confirmation that the software now enforces every deadline. Customer conversations take priority over a generic cadence.')
heading('1. What we are fixing')
paragraph('The audit screened 926 nondeleted CRM records, including 218 open pipeline records. Stored dates and assignments were incomplete, and the queue mixed genuine customers with vendors, relationship activity and stale outcomes. These figures are records, not unique qualified customers or a rep failure score. Do not treat every overdue field as permission to call.')
paragraph('Sandra is the example to prevent: an October 22 quote had follow-up September 29 and a voicemail September 30, but no later contact was found in the reviewed records. A quote needs an owned decision checkpoint. It must not disappear into a stage.')
paragraph('Pooja illustrates coverage: an immediate callback was promised after the reps finished at 5 p.m. John should have received and accepted the handoff. Sales and management must both meet their coverage responsibilities. This is not a requirement for reps to silently work beyond their shift.')
heading('2. Daily minimum standard')
for text in [
    'New enquiries, substantive replies and missed customer calls: personal response or callback attempt within 5 minutes during covered hours. An automated acknowledgement is not the human response.',
    'At 5 minutes without action, involve backup. At 10 minutes, escalate to John. Until automatic escalation is deployed and tested, perform the handoff explicitly.',
    'Every genuine opportunity has a named owner, an exact next action and a due time. A call attempt, completed conversation and fulfilled promise are separate outcomes.',
    'Within 10 minutes of a conversation, record the customer’s actual words where important, decision blockers, next action, owner and due time. Never invent a move date just to fill a field.',
    'At shift start, clear unanswered customers and missed promises first. Review overdue work at midday. At 4:45 p.m., prepare the handoff; John or scheduled backup accepts by 5 p.m.',
    'Handoff includes: customer and CRM link; last message; what was promised; urgency/move date; next action and deadline; accepting owner. A queue assignment without acknowledgement is not a completed handoff.',
    'Do not let photos or a web form become a dead end. Offer phone inventory or virtual review, confirm scope and provide a quote or a specific delivery time.',
    'Read the previous conversation before every call. Do not ask again for an address, date or item list the customer already supplied.',
]:bullet(text)
heading('3. Persistent follow-up, matched to the customer')
paragraph('For a genuine enquiry you cannot reach: initial call plus useful SMS; another attempt later that day; then days 1, 3 and 7 as appropriate. Default ceiling: two unsolicited call attempts and one useful written follow-up in a day across the team. Live two-way conversation is different. Adjust to customer instructions and the real move deadline.')
paragraph('For a quote: confirm receipt, discuss questions within one working day, and agree a decision checkpoint. Without an agreed date, use day 3 and day 7 follow-ups as a starting point. Ask a useful question about scope, timing or price rather than repeatedly asking for a deposit.')
paragraph('A customer-requested future callback wins over the default cadence. A house-sale dependency needs a dated review, not daily chasing. Chose another mover, wrong recipient and do-not-contact instructions leave the active chase. A past move date requires outcome verification. Silence alone is not proof of a lost sale.')
heading('4. Assigned work from this review')
tasks=read('recovery-task-receipts') if (P/'recovery-task-receipts.json').exists() else []
for t in tasks:
    if t.get('state')=='created':
        heading(t.get('name',t['leadId'])+' — '+t['owner'],2)
        paragraph('CRM task: '+t['id']+' • Due (Toronto): '+datetime.fromisoformat(t['due'].replace('Z','+00:00')).astimezone(ZoneInfo('America/Toronto')).strftime('%b %d, %I:%M %p'))
        paragraph('Open /sales/leads/'+t['leadId']+'. Task creation is confirmed; rep acceptance and completion still need verification.')
heading('5. Case context and next actions')
for name,lid,category,evidence,action in read('reviewed-findings'):
    if name=='Laura Lee Audy': continue
    heading(name+' — '+category,2)
    paragraph('Context: '+evidence)
    paragraph('Next step: '+action)
    if lid:paragraph('CRM: /sales/leads/'+lid)
heading('6. Case-based language')
paragraph('Sandra: “Hi Sandra, it’s Thelma. I’m following up on the estimate for your October 22 move. Are you still considering us, and is there anything about the scope or pricing you’d like us to go through?” Read new messages first and use the correct brand for her enquiry.')
paragraph('Sandy: “Hi Sandy, it’s Ommy. You asked about packing options and a possible October 20 move. If uploading photos is inconvenient, we can go through the inventory over the phone. Are those plans still current?”')
paragraph('After a useful conversation: “What would be a good time for me to check back with you?” Then record the answer, set the task, and fulfil it. Do not promise a time you cannot cover.')
heading('7. How we measure performance')
for text in [
    'Human response: target at least 95% within 5 covered minutes. Track median and 90th percentile; review every breach. Automated texts do not count.',
    'Promises and missed calls: 100% accounted for, with at least 95% of promised actions on time. Tell the customer before a delay.',
    'Ownership and next steps: 100% of genuine live opportunities have a named owner and due action.',
    'Shift end: zero silently abandoned obligations. Complete, record an agreed customer wait, or transfer to an accepting person.',
    'Quality: review five conversations per rep weekly plus serious complaints and missed promises. Coach on accuracy, listening and follow-through.',
    'Conversion: qualified enquiry → quote → deposit → completed move. Exclude vendor pitches, duplicates and relationship-only records from the customer funnel.',
]:bullet(text)
heading('8. Reviewed corrections and boundaries')
heading('Loss feedback and unwanted callers',2)
paragraph('For every genuine lost opportunity, record the outcome and the customer’s underlying reason separately. “Chose another mover” does not by itself establish whether price, availability, trust or communication drove the choice. Read existing evidence first. If the reason remains unclear and contact is welcome, ask once: “Thanks for letting us know. To help us improve, what made the other option a better fit for you?”')
paragraph('Log: customer’s exact words; reason category; call/SMS/email and date; competitor and price only when volunteered; owner; feedback status (not asked, asked, answered, declined, no response); and one improvement action. Do not convert silence into a reason, reopen a sales chase, or send repeated reminders. If the reason is already known or the customer requested no contact, do not ask again.')
paragraph('Verified scam/unwanted vendor numbers belong on the persistent blocked-callers list and their CRM records should leave active Sales. They are not lost customers and must never receive loss-feedback requests. Validate the external phone number against the recording and protect company/rep lines. Deleting the CRM record does not remove the block; raw evidence and audit records remain available.')
if (P/'loss-feedback-tasks.json').exists():
    paragraph('Loss-feedback review tasks are assigned to Thelma for Jana and John for Keyvan. These are internal review/request tasks; no feedback message was sent by this update.')
if (P/'vendor-cleanup/verification.json').exists():
    v=json.loads((P/'vendor-cleanup/verification.json').read_text())
    paragraph('Verified live cleanup: '+str(v['numbersBlocked'])+' unwanted Yellow Pages caller numbers on the persistent block list; '+str(len(v['records']))+' associated lead records removed from active Sales using reversible CRM deletion.')
paragraph('Four vendor records were classified as non-sales: Steve Saintil, Avery Rivera, Tyler from SmartMoving and the related SmartMoving call stored under John. Their history remains intact. Jana and Keyvan were marked Lost based on explicit statements that they chose another mover; sales automation was placed in handoff rather than triggering another chase.')
paragraph('Owner-managed personal-line conversations are excluded from this work list. No instruction here authorizes contacting those cases. Do not mass-message everyone with an old date. Review context, assign the right queue and record the actual next step.')
paragraph('Released to master and production on October 16, 2026 (commit bd8825b, PR #148): reviewed non-sales/service records are separated, unknown callers remain visible, and past-date deposit guidance is replaced with outcome review. Persistent blocking also covers SMS and missed-call callbacks. The release passed 633 logic tests, type checking, the hosted production build and read-only live checks. The live CRM work includes six record corrections, seven recovery tasks, two loss-feedback review tasks and the verified vendor block/removal results above. Automatic timed escalation and accepted after-hours handoff tracking remain outstanding; the team must carry out the written handoff standard explicitly.')
heading('Appendix: partnership-to-sales context')
paragraph('The following 35 case summaries come from the earlier October 16 partnership audit. They provide handoff context, not fresh completion confirmations. Check the current thread before acting. Duplicate lead IDs do not represent additional customers.')
partners=json.loads(Path('artifacts/partner-sales-audit-20261016/reviewed-opportunities.json').read_text())
for p in partners:
    heading(p['name']+' — '+p['outcome'],2)
    paragraph(p['assessment'])
    paragraph('Recorded Sales evidence: '+p['sales_evidence'])
    paragraph('CRM records: '+', '.join(p.get('lead_ids',[])))
paragraph('Audit limits: calls and texts made on personal phones may not appear in CRM. Missing stored evidence is not proof that no action occurred. Current stage labels are not proof of booking, loss or completion.')
doc.save(P/'Sales-Team-Response-and-Follow-Up-Brief.docx')
style='body{font:16px system-ui;max-width:1000px;margin:40px auto;padding:0 20px;line-height:1.6;color:#172536}h1,h2{line-height:1.25}h2{margin-top:30px}p{margin:12px 0}@media print{body{font-size:11pt}h2{break-after:avoid}}'
(P/'sales-team-brief.html').write_text('<!doctype html><html><head><meta charset="utf-8"><title>Sales team response and follow-up brief</title><style>'+style+'</style></head><body>'+''.join(parts).replace('<h0>','<h1>').replace('</h0>','</h1>')+'</body></html>')
print('Created DOCX and printable HTML team brief; Laura excluded; '+str(len(partners))+' partnership case summaries.')
