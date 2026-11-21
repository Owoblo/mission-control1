"""Prepare source-specific drafts. Never sends or changes canonical release files."""
import json
from partnership_localization import location_line
from pathlib import Path
root=Path('partnership-system/markets/ca/on/windsor-kitchener/runs/2026-09-15/contact-qualification')
routes=json.loads((root/'routes.json').read_text());assessments={r['route_id']:r for r in json.loads((root/'assessments.json').read_text())}
copy={
'RBC Place London':('Moving support for event changeovers','I saw that RBC Place has an exhibitor and supplier section on its website.','If your team ever needs help moving furniture or boxed materials around an event changeover, we would be happy to discuss the scope.','Does that sit with your events team, or is there a supplier registration process we should follow?'),
'The Landing Pad':('A moving contact for your furnished rentals','I came across The Landing Pad’s furnished rentals and relocation offering in St. Thomas.','We would like to be a moving contact when a guest needs help bringing their belongings in, or your team needs furniture moved between properties.','Who would be the best person to speak with about that?'),
'Grand Bend U Store It':('Moving help for your storage customers','I saw that Grand Bend U Store It offers both short- and long-term storage.','When someone has a unit arranged but still needs help getting their belongings there, we would like to be a moving contact your team can share.','Do you keep a list of local movers for customers?'),
'Robinson Design & Drafting':('Moving furniture around a renovation','I noticed that Robinson Design & Drafting covers home renovations as well as commercial space planning.','If a client needs furniture cleared before work starts and moved back afterward, we would be happy to discuss the moving portion.','Would it be useful to have our contact details for those situations?'),
'Juce Computers':('A moving contact alongside an office setup','I saw that Juce Computers serves customers from Petrolia and Ridgetown.','If an office relocation comes across your desk, we can discuss moving the furniture and boxed contents alongside the client’s IT arrangements.','Who on your team handles relationships with other local service providers?'),
'Bluewater Regional Networks Inc.':('When a business customer changes premises','I saw that Bluewater Regional Networks serves business and commercial customers in Sarnia-Lambton.','When a customer is arranging connectivity for new premises, they may also need a mover for the office furniture and contents. We would like to be a contact your team can pass along when that comes up.','Is there someone who handles local service-provider relationships?'),
'Bluewater First Aid Training Centre':('A moving contact for your training centre','I came across your first aid and CPR courses in Sarnia.','If your team needs classroom furniture or boxed supplies moved between spaces, we would be happy to discuss the job and provide a quote.','Would that be handled by the centre manager?'),
'Anderson-Webb Limited':('Who handles moving suppliers at Anderson-Webb?','I saw Anderson-Webb’s industrial fabrication and installation work in Sarnia.','We would like to be considered when your team needs office furniture or boxed contents moved. We can review the scope with the person organizing it.','Is facilities the right team to speak with, or do moving suppliers go through purchasing?')}
output=[]
for company,(subject,context,offer,question) in copy.items():
 matches=[r for r in routes if r['company']==company and assessments[r['route_id']]['minimum_status']=='basic_candidate']
 if not matches:continue
 r=sorted(matches,key=lambda r:r['email'])[0]
 local=location_line(r['city'],r.get('organization_site_supported'))
 if local and r['city'].lower() not in context.lower():context=context+' '+local
 body=f"Hello {company} team,\n\n{context}\n\nI’m John with Saturn Star Movers. {offer}\n\n{question}\n\nJohn\nSaturn Star Movers\n3608 Seminole Street, Windsor, ON\nIf you prefer no further emails, just reply and let me know."
 output.append({'route_id':r['route_id'],'company':company,'to':r['email'],'subject':subject,'body':body,'source':r['publication_url'],'mailbox_status':assessments[r['route_id']]['mailbox_status'],'status':'draft_requires_live_company_history_preflight','sent':False})
(root/'localized-contextual-drafts.json').write_text(json.dumps(output,indent=2))
(root/'LOCALIZED-CONTEXTUAL-DRAFTS.md').write_text('# Source-specific drafts — not sent\n\nMailbox existence remains uncertain. Refresh company-wide CRM/mail history and suppression before release.\n\n'+'\n\n---\n\n'.join(f"## {r['company']}\n\nTo: {r['to']}\n\nSubject: {r['subject']}\n\n{r['body']}\n\nEvidence: {r['source']}" for r in output))
print(json.dumps({'drafts':len(output),'sent':0}))
