import csv,json,math
from pathlib import Path
from collections import Counter
root=Path('deliverables/gta-launch-20260926')
rows=list(csv.DictReader((root/'candidates-after-crm-check.csv').open(encoding='utf-8',newline='')))
basic=set('@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà')
ext=set('^{}\\[~]|€\f')
def parts(s):
 if all(c in basic or c in ext for c in s):
  n=sum(2 if c in ext else 1 for c in s);return ('GSM-7',1 if n<=160 else math.ceil(n/153))
 n=len(s.encode('utf-16-le'))//2;return ('Unicode',1 if n<=70 else math.ceil(n/67))
template=json.loads((root/'realtor-sms-preview.json').read_text())['template']
counts=Counter();segments=0;max_chars=0
for row in rows:
 text=template.format(first=row.get('first_name') or row['name'].split()[0],city=row['crm_city'])
 encoding,n=parts(text);counts[f'{encoding}:{n}']=counts[f'{encoding}:{n}']+1;segments+=n;max_chars=max(max_chars,len(text))
result={'currency':'USD','billing':'per SMS segment plus destination carrier surcharge','template':template,'example':template.format(first='Sarah',city='Mississauga'),'example_characters':len(template.format(first='Sarah',city='Mississauga')),'candidate_rows':len(rows),'actual_template_segments':segments,'segment_distribution':dict(counts),'longest_personalized_character_count':max_chars,'base_rate_observed_account_and_sms_api':.0025,'alternative_public_outbound_rate_deck':.004,'major_ontario_mobile_budget_rate_per_segment':[.00908,.012845],'candidate_template_cost_range_usd':[round(segments*r,2) for r in [.00908,.012845]],'all_29108_destinations_one_segment_range_usd':[round(29108*r,2) for r in [.00908,.012845]],'all_29108_destinations_two_segment_range_usd':[round(29108*2*r,2) for r in [.00908,.012845]],'inbound_reply_base_10_percent_29108':[round(29108*.1*r,2) for r in [.0025,.004]],'caveats':['Not all 29108 destinations are independently verified eligible mobiles','Shared destinations do not have a uniquely assigned personal greeting','Carrier mix unknown; budget band uses major Ontario mobile carriers, not all possible network charges','Taxes, payment fees, phone rental, lookup, call/transcription fees and further follow-ups excluded','Template is a cost example, not an approved campaign or a substitute for reviewing current thread']}
(root/'sms-cost-estimate.json').write_text(json.dumps(result,indent=2));print(json.dumps(result,indent=2))
