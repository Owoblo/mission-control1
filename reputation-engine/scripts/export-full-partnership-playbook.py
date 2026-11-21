"""Compile the complete playbook source bundle into an editable Word document."""
from pathlib import Path
from datetime import datetime,timezone
import csv,json,re,hashlib
from docx import Document
from docx.shared import Inches,Pt,RGBColor
from email.message import EmailMessage
from email.policy import SMTP
root=Path('partnership-system');out=root/'exports';out.mkdir(exist_ok=True)
sources=[root/'README.md']
for folder in ['operations','channels','segments','technical','catalogs']:
 sources+=sorted((root/folder).glob('*.md'))
sources += [root/'markets/market-template.md',root/'markets/ca/on/windsor-essex/README.md',root/'markets/ca/on/windsor-kitchener/README.md']
sources += [Path('docs')/n for n in ['partnership-relationship-playbook.md','commercial-partnership-playbook.md','commercial-institutional-growth-playbook.md','saturn-star-crm-operating-playbook.md']]
sources += [Path('/Users/owoblo/Downloads/REALTORS')/n for n in ['PLAYBOOK.md','OUTREACH_TEMPLATES.md']]
sources += [root/'RESTART-HANDOFF.md',root/'CHANGELOG.md']
assert all(p.exists() for p in sources)
doc=Document();sec=doc.sections[0];sec.header.paragraphs[0].text='SATURN STAR MOVERS | PARTNERSHIPS'
sec.top_margin=sec.bottom_margin=Inches(.7)
normal=doc.styles['Normal'];normal.font.name='Calibri';normal.font.size=Pt(10)
normal.paragraph_format.space_after=Pt(5)
doc.add_heading('Complete Partnership Playbook',0);doc.add_paragraph('Operations • Discovery • Enrichment • Outreach • Relationships • Commercial Graph V2',style='Subtitle')
doc.add_paragraph('Analysis copy | September 15, 2026 | Editable Word document')
doc.add_heading('Read this first',1)
doc.add_paragraph('This is the complete current playbook source bundle, including legacy operating instructions and the latest architecture work. It is intended for review and analysis. Historical counts and proposed capabilities are preserved in their source chapters; they are not all current production capabilities. The latest checkpoint below takes precedence when interpreting status. No credentials or raw prospect database exports are included.')
doc.add_heading('Current operational checkpoint',1)
doc.add_paragraph('Discovery V2 is implemented and tested locally; deployment remains held. Current work uses practical minimum contact checks, not a claim of 100% mailbox accuracy. Public DNS and saved AWS evidence are separate from company, branch and recipient-role relevance. Failed addresses, opt-outs and existing conversations retain their holds. SMTP probing and an external paid verifier are not installed. 32 Discovery V2 tests passed before this export.')
doc.add_paragraph('Seven contextual introductions were accepted in the preceding batch. A further 81 prepared messages are being processed through live CRM, mailbox-history, suppression and delivery checks. The source snapshot may precede the final batch outcome; consult the separate delivery receipt rather than treating prepared contacts as sent.')
doc.add_paragraph('The local contact review covered 359 routes from 1,766 cached website reviews. The commercial graph contains additional provisional discovery entities; they are not equivalent to verified contacts. Counts in older chapters may refer to an earlier stage or a different scope.')
doc.add_heading('Source index',1)
for i,p in enumerate(sources,1):doc.add_paragraph(f'{i}. {p}',style='List Number')
manifest=[]
for i,p in enumerate(sources,1):
 text=p.read_text();manifest.append({'path':str(p),'sha256':hashlib.sha256(text.encode()).hexdigest(),'characters':len(text)})
 doc.add_page_break();doc.add_heading(f'{i}. {p.stem.replace("-"," ").replace("_"," ").title()}',1);doc.add_paragraph('Source: '+str(p))
 code=False
 for line in text.splitlines():
  if line.startswith('```'):code=not code;continue
  if not line.strip():continue
  if code:
   para=doc.add_paragraph(line);para.paragraph_format.space_after=Pt(0)
   for run in para.runs:run.font.name='Consolas';run.font.size=Pt(8)
  elif re.match(r'^#{1,6} ',line):
   level=len(line)-len(line.lstrip('#'));doc.add_heading(line[level:].strip(),min(level+1,4))
  elif re.match(r'^\s*[-*] ',line):doc.add_paragraph(line.strip()[2:],style='List Bullet')
  else:doc.add_paragraph(line)
doc.add_page_break();doc.add_heading('Appendix: Complete Canadian industry discovery taxonomy',1)
rows=list(csv.DictReader((root/'catalogs/classifications.csv').open()))
industry=[r for r in rows if r['system']=='NAICS-CA-2022-v1' and r['level']=='5'];assert len(industry)==923
for r in industry:doc.add_paragraph(r['code']+' — '+r['title'])
doc.add_heading('Appendix: People and role taxonomy',1)
roles=[r for r in rows if r['system']=='NOC-2021-v1' and r['level']=='5']
for r in roles:doc.add_paragraph(r['code']+' — '+r['title'])
doc.add_heading('Appendix: Service locations and aliases',1)
locations=list(csv.DictReader((root/'catalogs/service-areas.csv').open()))
for region in dict.fromkeys(r['region_label'] for r in locations):
 doc.add_heading(region,2)
 for r in locations:
  if r['region_label']==region:doc.add_paragraph(r['location']+' — '+r['kind'])
name='Saturn-Star-Movers-Complete-Partnership-Playbook-2026-09-15.docx';path=out/name;doc.save(path)
check=Document(path);assert len(check.paragraphs)>500
manifest_report={'created_at':datetime.now(timezone.utc).isoformat(),'sources':manifest,'source_count':len(sources),'industry_categories':len(industry),'occupation_categories':len(roles),'location_rows':len(locations),'paragraphs':len(check.paragraphs),'attachment':name,'bytes':path.stat().st_size}
(out/'full-playbook-manifest.json').write_text(json.dumps(manifest_report,indent=2))
msg=EmailMessage(policy=SMTP);msg['From']='John | Saturn Star Movers <john@saturnstarmovers.ca>';msg['To']='business@starmovers.ca';msg['Subject']='Complete partnership playbook — Word document for analysis';msg['Reply-To']='business@starmovers.ca'
msg.set_content('Attached is the complete partnership playbook for analysis: operating workflows, discovery and enrichment, SMS/email/direct-mail relationships, reply handling, verification, Discovery V2 architecture, realtor playbook, and full Canadian industry/occupation and service-location appendices.\n\nThe opening checkpoint distinguishes implemented work from planned capabilities. Older source chapters retain historical counts and instructions. The remaining outreach batch is being processed separately; prepared records are not all sent.\n\nJohn\nSaturn Star Movers')
msg.add_attachment(path.read_bytes(),maintype='application',subtype='vnd.openxmlformats-officedocument.wordprocessingml.document',filename=name)
(out/'full-partnership-playbook-email.eml').write_bytes(msg.as_bytes())
print(json.dumps({k:v for k,v in manifest_report.items() if k!='sources'}))
