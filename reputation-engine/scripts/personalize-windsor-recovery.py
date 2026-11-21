"""Apply human-reviewed, source-checked context to unsent recovery introductions."""
import json,html
from pathlib import Path
P=Path('partnership-system/markets/ca/on/windsor-essex/runs/2026-09-15/send-release')
release=json.loads((P/'published-company-expanded-release.json').read_text())
evidence={r['id']:r for r in map(json.loads,(P/'company-publication-deep-review.jsonl').read_text().splitlines())}
# email | exact evidence phrase | concise paraphrase for introduction
raw='''info@omegatoolcorp.com|Plastics for Mobility and Beyond|I saw Omega’s work in plastics tooling and your Oldcastle location. I wanted to introduce a nearby moving contact for office changes and furniture transfers.
info@etr.ca|Transmodal Services|I was reading about ETR’s rail and transmodal services in Windsor. I wanted to introduce a local moving crew your operations team could keep on file for office and furniture transfers.
info@integrisgroup.ca|International Recruitment|I saw that Integris helps employers recruit and onboard people from Canada and abroad. If a new hire needs a local household move, I’d like your team to have a moving contact to pass along.
info@crescenzaconsulting.com|digital transformation|I saw Crescenza’s work helping businesses with IT and digital transformation. I wanted to introduce a local moving contact for the physical office changes that can accompany a growing team.
info@2000ams.com|Oil and Gas, Locomotive, Marine, and Automotive|I saw that AMS machines parts for sectors including locomotive and marine, from your Electricity Drive location. I wanted to introduce a local moving contact for office reshuffles and furniture transfers.
info@bxfii.com|Heavy Civil Construction|I saw BXF’s heavy civil and infrastructure work. When a project office needs furniture moved in, rearranged or cleared out, I’d like your team to have a local moving contact available.
info@venturelabels.com|2120 Fasan Dr|I found Venture Labels’ Fasan Drive contact details. We’re based in Windsor, and I wanted to introduce a nearby moving crew for office changes or furniture transfers at your site.
contact@netmonservices.com|Managed IT Services|I saw Netmon’s managed IT and consulting work for Windsor–Essex businesses. Office changes can involve both technology and physical moves, so I wanted to introduce a contact for the packing and furniture side.
info@soffistudio.com|hospitality and residential projects|I saw Soffi’s glass work for hospitality and residential interiors. I wanted to introduce a local contact for office and furniture moves around your workspace or project handovers.
info@proax.ca|Automation & Electronic Components|I saw Proax’s automation and electronic-component distribution work. I wanted to introduce a local moving contact for office changes and furniture transfers involving your Windsor team.
info@greensunrising.com|1680 Kildare Rd|I came across Green Sun Rising’s solar work and Kildare Road location. I wanted to introduce a nearby moving contact for office changes and furniture transfers as workspace needs change.
info@spm-automation.com|Custom Solutions Designed for you|I saw SPM’s custom automation and plastics-joining work. I wanted to introduce a local moving contact for office reshuffles and furniture transfers at your site.
info@thepastahouse.ca|Fresh Pasta|I came across The Pasta House while looking at local food producers. I wanted to introduce a Windsor moving contact for office furniture and other workspace transfers when those smaller jobs come up.
contact@nextdimensioninc.com|Managed IT Services & Private Cloud|I saw Next Dimension’s managed IT and private-cloud services. When a business changes offices, there’s often a physical move alongside the technology work, so I wanted to introduce a local furniture-moving contact.
info@compoundcad.com|machinery, furniture, architecture|I saw that Compound CAD works across machinery, furniture and architectural design. I wanted to introduce a local moving contact for office furniture and workspace changes when a project reaches that stage.
info@checkerindustrial.com|Material Handling & Storage|I saw Checker’s industrial supply range, including material handling and storage. I wanted to introduce a local moving contact for office and furniture transfers at your own locations.
contact@yqgtech.com|custom software solutions|I saw YQG Technologies’ custom software and digital transformation work. I wanted to introduce a local moving contact for office furniture and workspace changes as your team’s needs evolve.
info@capitalassist.ca|Transaction and Deal Advisory Services|I saw Capital Assist’s business valuation and transaction advisory work. If a business owner you work with needs help with an office move, I’d like your team to have a local moving contact to pass along.
info@lakeshorelogistics.ca|Automotive Hauling|I saw Lakeshore Logistics’ automotive hauling work between Canada and the United States. I wanted to introduce a local packing and furniture-moving contact for smaller site or office jobs that arise alongside your main operations.
info@divisionmachine.com|CNC MACHINING & EDM|I saw Division Machine’s CNC machining and EDM capabilities. I wanted to introduce a local moving contact for office reshuffles and furniture transfers at your workplace.
info@mercprod.com|Engineered Fabrications & Assemblies|I saw Mercury’s engineered fabrication and assembly work. I wanted to introduce a local moving contact for office furniture and workspace transfers involving your Windsor operations.
office@fcfcustom.com|5515 Roscon Industrial Drive|I found FCF’s Roscon Industrial Drive contact details. I wanted to introduce a nearby moving crew for office changes and furniture transfers when your site needs an extra set of hands.
hello@cedarvalleyselections.ca|Pita Chips|I came across Cedar Valley’s pita chips and your local business details. I wanted to introduce a Windsor moving contact for office furniture and workspace transfers when those jobs come up.
admin@movinfreight.com|flatbed and specialized carrier|I saw that Movin’ Freight is an Oldcastle-based flatbed and specialized carrier. I wanted to introduce a nearby crew for local packing, loading and furniture-moving jobs that sit outside your regular freight work.
info@propowermfg.com|steel, aluminum and stainless steel|I saw Propower’s steel, aluminum and stainless-steel fabrication work in LaSalle. I wanted to introduce a local moving contact for office reshuffles and furniture transfers.
info@arkconsulting.ca|arrival to Ontario|I saw that Ark’s recruitment work supports candidates through their arrival in Ontario. If an arriving employee needs help with a local household move, I’d like your team to have a moving contact to pass along.
info@srtaccounting.com|start-up or an established enterprise|I saw that SRT works with both start-ups and established businesses. If a client needs help moving offices, I’d like your team to have a local moving contact available to pass along.
info@advancebusiness.net|Printer & Copier Services|I saw Advance Business Systems’ print, IT and ergonomic solutions for local workplaces. I wanted to introduce a moving contact for the office furniture and packing side when a customer changes space.
inquiries@absolutetooltech.com|precision molds|I saw Absolute Tool’s precision mold design and manufacturing work. I wanted to introduce a local moving contact for office changes and furniture transfers at your workplace.
hello@circle5.io|production & prototyping|I saw Circle 5’s work in production and prototype injection molds. I wanted to introduce a local moving contact for office reshuffles and furniture transfers when your site needs them.
info@whitfieldwelding.com|repair, refurbishment, and part enhancement|I saw Whitfield’s focus on tool repair and refurbishment. I wanted to introduce a local moving contact for the office and furniture jobs that come up around an industrial workspace.
info@truephantom.com|2090 Fasan Dr|I found True Phantom’s Fasan Drive location while reading about your imaging products. I wanted to introduce a nearby moving contact for office furniture and workspace changes.
admin@kscrap.com|Demolitions & Property Cleanouts|I saw that K-Scrap serves demolition and property-cleanout projects as well as manufacturers. If a customer needs usable furniture moved before the metal-recycling stage, I’d like your team to have a local moving contact to pass along.
office@genesismold.com|MOLD MAKING|I came across Genesis Mold’s engineering and mold-making work. I wanted to introduce a local moving contact for office reshuffles and furniture transfers at your site.
office@southwesternmanufacturing.com|3710 Peter Street|I saw Southwestern Manufacturing’s Peter Street location and the range of industrial markets you serve. I wanted to introduce a local moving contact for office and furniture transfers at your workplace.
team@idolcoreindustries.com|manufactured parts|I saw Idol Core’s focus on manufactured parts and working through customers’ production needs. I wanted to introduce a local moving contact for office changes and furniture transfers at your own site.
office@sharpedgetool.com|tool sharpening services|I saw Sharp Edge’s tool-sharpening and machining work in Windsor. I wanted to introduce a nearby moving contact for office reshuffles and furniture transfers.
contact@ampel.ca|Door Access Control|I saw Ampel’s work with cameras, alarms and door access for commercial properties. Office changes often bring several trades together, so I wanted to introduce a contact for the furniture-moving side.
contact@copperrose.ca|HANDCRAFTED IN ONTARIO|I came across Copper Rose’s Ontario-made spirits and your local business details. I wanted to introduce a Windsor moving contact for office furniture and workspace transfers when those jobs come up.
info@foxdconsulting.com|Business Consulting|I came across Fox D’s business consulting work. If a business you advise needs help with an office move, I’d like your team to have a local moving contact to pass along.
info@acenzia.com|Bio-Science|I saw Acenzia’s manufacturing and bioscience work. I wanted to introduce a local moving contact for office furniture and general workspace transfers when those smaller jobs come up.
hello@sisulegal.com|United States and Canada|I saw that Sisu helps individuals, families and businesses with US and Canadian immigration. If a client settling in Windsor–Essex needs a local household move, I’d like your team to have a moving contact to pass along.
info@dctool.ca|Design & Build All Under One Roof|I saw DC Automotive Tooling’s focus on keeping design and build under one roof. I wanted to introduce a local moving contact for office changes and furniture transfers at your workplace.
info@windsorpallets.com|packaging needs|I saw Windsor Pallet’s packaging work and North Talbot Road plant details. I wanted to introduce a local packing and furniture-moving contact for office or site jobs outside your regular pallet work.
info@colonialtool.com|Spindle Repair|I saw Colonial Tool’s spindle repair, broaching and tooling services. I wanted to introduce a local moving contact for office reshuffles and furniture transfers at your site.
info@skymobilecorp.com|232 Drouillard Rd|I saw Sky Mobile’s fleet and communications work from Drouillard Road. I wanted to introduce a nearby moving contact for office furniture and workspace transfers when your team needs them.
info@acmetalfabricating.com|steel designer, fabricator, and erector|I saw AC Metal’s structural steel design, fabrication and installation work. I wanted to introduce a local moving contact for office furniture and project-workspace transfers.
info@logicexecutivesearch.com|executive recruitment|I saw Logic’s executive recruitment and workplace support services. If a new hire needs a local household move, I’d like your team to have a Windsor moving contact to pass along.
info@webplanet.ca|WP Essex|I came across WP Essex’s print, design and branding work. I wanted to introduce a local moving contact for office furniture and workspace changes when your team or a business client needs help.
info@myprintsupplier.com|Windsor Printing Services|I came across A&A’s Windsor printing and signage services. I wanted to introduce a local moving contact for office furniture and workspace transfers when those jobs come up.
info@etlasfreight.com|Temperature-Controlled|I saw Etlas’s temperature-controlled cross-border freight work. I wanted to introduce a local moving contact for office furniture and smaller workspace transfers at your Windsor operation.
info@ontechcoatings.com|Corrosion repair and protection|I saw ONtech’s corrosion repair and protective coating work. I wanted to introduce a local moving contact for office furniture and workspace transfers when your own site needs them.
contact@teamintegrity.com|Our New Facility: HD2|I saw the HD2 facility featured on Integrity’s website, including its programming office and meeting spaces. I wanted to introduce a local moving contact for office furniture and workspace transfers across your Windsor sites.'''
facts={}
for line in raw.splitlines():
 email,needle,copy=line.split('|',2);facts[email]=(needle,copy)
changed=[]
for d in release['initial'][57:]:
 needle,copy=facts[d['to']]
 page=next((p for p in evidence[d['id']]['pages'] if needle.lower() in p['text'].lower()),None)
 if not page:raise ValueError('Missing context evidence: '+d['to']+' '+needle)
 pieces=d['body'].split('\n\n');pieces[1]=copy
 if d['to'] in {'info@integrisgroup.ca','info@arkconsulting.ca','hello@sisulegal.com','info@logicexecutivesearch.com'}:
  pieces[2]='I’m John with Saturn Star Movers. We help with household moves in Windsor–Essex, including packing, loading, transport and placement. We review the details and timing with the customer before quoting.'
  pieces[3]='Is there a process for introducing a local moving service your team could keep on file for clients or new hires?' if d['variant']=='A' else 'Who would be the best person to speak with about being a local moving resource for clients or new hires?'
 d['body']='\n\n'.join(pieces);d['context_source']=page['resolved_url'];d['personalization_evidence']={'phrase':needle,'source':page['resolved_url'],'checked_at':evidence[d['id']]['checked_at']}
 if d['to']=='info@webplanet.ca':d['body']=d['body'].replace('Hello Webplanet.ca team,','Hello WP Essex team,')
 if d['to']=='info@etr.ca':d['body']=d['body'].replace(pieces[0],'Hello ETR team,')
 changed.append({'to':d['to'],'fact':copy,'source':page['resolved_url']})
(P/'published-company-expanded-release.json').write_text(json.dumps(release,indent=2,ensure_ascii=False))
(P/'recovery-personalization-evidence.json').write_text(json.dumps(changed,indent=2,ensure_ascii=False))
proof='<!doctype html><meta charset="utf-8"><title>Recovery email proofs</title><style>body{font:16px/1.6 Arial;max-width:800px;margin:40px auto}article{border-top:3px solid #c99700;padding:20px 0}pre{font:inherit;white-space:pre-wrap}</style><h1>Reviewed recovery email proofs</h1>'
for d in release['initial'][57:]:proof+=f'<article><h2>{html.escape(d["account_name"])}</h2><p>{html.escape(d["to"])} — {d["variant"]}</p><pre>{html.escape(d["body"])}</pre><a href="{html.escape(d["context_source"],quote=True)}">Context source</a></article>'
(P/'published-company-expanded-proofs.html').write_text(proof)
print(json.dumps({'personalized':len(changed),'source_phrases_verified':len(changed)}))
