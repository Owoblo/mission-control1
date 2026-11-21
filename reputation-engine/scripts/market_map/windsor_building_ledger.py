"""Per-footprint research ledger; automated matches never complete investigations."""
import collections
from datetime import datetime, timezone
import html
import json
from pathlib import Path
from .windsor_physical_report import ROOT, PLACES
from .windsor_address_investigation import reconcile_evidence
from .windsor_batch_merge import validate_reference

STAGES = ('address', 'occupants', 'contacts')


def write_review_browser(ledger, out):
    """Show actual recorded investigations, including evidence and unresolved gaps."""
    reviewed = [r for r in ledger if r.get('review_events')]
    cards = []
    for row in reviewed:
        title = ' / '.join(row['candidate_addresses']) or 'Address unresolved'
        details = []
        for event in row['review_events']:
            url = event.get('source_url', '')
            link = ('<a target="_blank" rel="noopener" href="'+html.escape(url, quote=True)+'">Source</a>') if url.startswith(('https://', 'http://')) else ''
            details.append('<details><summary>'+html.escape(event['stage'].title()+' — '+event['outcome']+' — '+event['checked_on'])+'</summary><p>'+html.escape(event['finding'])+'</p><p>Scope: '+html.escape(event['scope'])+'</p><p>Still unknown: '+html.escape('; '.join(str(g) for g in event['remaining_gaps']) or 'No additional gaps recorded for this limited check')+'</p>'+link+'</details>')
        names = ', '.join(p['name'] for p in row['reported_places'])
        search = (title+' '+names+' '+' '.join(e['finding'] for e in row['review_events'])).lower()
        cards.append('<article data-search="'+html.escape(search, quote=True)+'"><h2>'+html.escape(title)+'</h2><p>'+html.escape(row['building_id'])+' · '+('Reviewed within recorded scope' if row['investigation_status']=='scope_reviewed' else 'Investigated; gaps remain')+'</p><p>Reported names: '+html.escape(names or 'See findings below')+'</p>'+''.join(details)+'</article>')
    (out/'reviewed.html').write_text('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Windsor investigations so far</title><style>body{max-width:1100px;margin:30px auto;padding:20px;background:#101b28;color:#edf5ff;font:17px system-ui}a{color:#72dfcb}input{box-sizing:border-box;width:100%;padding:14px}article{border:1px solid #456;border-radius:10px;padding:20px;margin:20px 0}summary{cursor:pointer;padding:10px}p{line-height:1.5}article[hidden]{display:none}</style><h1>Windsor: investigations so far</h1><p>'+str(len(reviewed))+' building outlines with recorded investigation. These are not necessarily separate properties or fully resolved businesses.</p><p><a href="index.html">All building candidates</a> · <a href="../windsor-address-pilot-20261029/map.html">Open the map</a></p><input id="search" aria-label="Search investigations" placeholder="Search a business, address or finding"><p id="count"></p>'+''.join(cards)+'<script>const q=document.getElementById("search"),cards=[...document.querySelectorAll("article")];q.oninput=()=>{let n=0;for(const c of cards){c.hidden=!c.dataset.search.includes(q.value.toLowerCase());if(!c.hidden)n++}document.getElementById("count").textContent=n+" investigated outlines shown"};q.oninput();</script>')


def apply_reviews(building_id, events, root=ROOT):
    stages, accepted, rejected = {}, [], []
    for event in events:
        if event.get('building_id') != building_id:
            continue
        try:
            if event.get('stage') not in STAGES or event.get('outcome') not in ('reviewed', 'unresolved'):
                raise ValueError('Invalid research stage or outcome')
            for field in ('checked_on', 'reviewer', 'scope', 'finding'):
                if not isinstance(event.get(field), str) or not event[field].strip():
                    raise ValueError('Missing '+field)
            if not isinstance(event.get('remaining_gaps'), list):
                raise ValueError('Explicit remaining_gaps required, including an empty list')
            source = validate_reference(event, root)
            item = {**event, **source}
            accepted.append(item)
            stages[event['stage']] = event['outcome']
        except (KeyError, TypeError, ValueError) as error:
            rejected.append({'event':event, 'reason':str(error)})
    return stages, accepted, rejected


def entry(row, evidence, places, events=(), root=ROOT):
    stages, reviews, rejected = apply_reviews(row['building_id'], events, root)
    names = [{'source_id':gid, 'name':places[gid]['name'], 'source_url':places[gid].get('source_url')}
             for gid in row['covering_place_ids'] if gid in places]
    multi = [o for o in evidence if len(o['candidate_building_ids']) > 1]
    if not stages:
        next_action = 'Resolve competing address candidates' if row['status'] == 'address_conflict' else 'Check the candidate address against a primary source'
    elif stages.get('address') != 'reviewed':
        next_action = 'Resolve address review gaps'
    elif stages.get('occupants') != 'reviewed':
        next_action = 'Investigate organizations and units at this address'
    elif stages.get('contacts') != 'reviewed':
        next_action = 'Research scoped business or department contacts'
    else:
        next_action = 'Follow recorded gaps and refresh dates'
    return {'building_id':row['building_id'], 'longitude':row['longitude'], 'latitude':row['latitude'],
            'original_zoning_scope':row['business_zone_research_candidate'],
            'zoning_codes':row['source_zoning'], 'candidate_addresses':row['parcel_address_candidates'],
            'address_matching_status':row['status'], 'reported_places':names,
            'source_evidence_candidates':[{'organization':o['organization'], 'address':o['address'],
                'unit_or_floor':o.get('unit_or_floor'), 'source_url':o['source_url'],
                'candidate_building_count':len(o['candidate_building_ids'])} for o in evidence],
            'ambiguous_multi_footprint_observations':len(multi),
            'review_stages':stages, 'review_events':reviews,
            'investigation_status':'scope_reviewed' if all(stages.get(s)=='reviewed' for s in STAGES) else ('in_progress' if reviews else 'not_individually_reviewed'),
            'occupant_completeness':'unknown', 'next_action':next_action,
            'outreach_eligible':False}, rejected


def build():
    base = ROOT/'artifacts/windsor-address-pilot-20261029'
    out = ROOT/'artifacts/windsor-building-ledger-20261029'
    out.mkdir(exist_ok=True)
    rows = [json.loads(x) for x in (base/'building-address-candidates.jsonl').read_text().splitlines()]
    places = {p['gers']:p for p in map(json.loads, PLACES.read_text().splitlines())}
    evidence = json.loads(Path(__file__).with_name('windsor_address_evidence.json').read_text())
    reconciled = reconcile_evidence(evidence, rows, places)
    by_building = collections.defaultdict(list)
    for o in reconciled:
        for bid in o['candidate_building_ids']:
            by_building[bid].append(o)
    review_file = out/'review-events.jsonl'
    events = [json.loads(x) for x in review_file.read_text().splitlines() if x.strip()] if review_file.exists() else []
    ledger, rejected = [], []
    ids = {r['building_id'] for r in rows}
    rejected.extend({'event':e, 'reason':'Unknown building ID'} for e in events if e.get('building_id') not in ids)
    for row in rows:
        if not (row['business_zone_research_candidate'] or row['covering_place_ids'] or by_building[row['building_id']]):
            continue
        item, held = entry(row, by_building[row['building_id']], places, events)
        ledger.append(item); rejected.extend(held)
    ledger.sort(key=lambda r:(not r['original_zoning_scope'], r['address_matching_status']!='address_conflict', r['building_id']))
    summary = {'checked_at':datetime.now(timezone.utc).isoformat(), 'target_building_features':len(ledger),
               'original_zoning_features':sum(r['original_zoning_scope'] for r in ledger),
               'with_reported_place':sum(bool(r['reported_places']) for r in ledger),
               'with_source_candidate':sum(bool(r['source_evidence_candidates']) for r in ledger),
               'individual_research_status':dict(collections.Counter(r['investigation_status'] for r in ledger)),
               'rejected_review_events':len(rejected),
               'limits':'Outlines can be roof sections, not unique properties. Candidate matches and published business names are clues. Individual review requires a scoped, sourced review event. Scope reviewed never means every occupant is known.'}
    (out/'buildings.jsonl').write_text(''.join(json.dumps(r)+'\n' for r in ledger))
    (out/'summary.json').write_text(json.dumps(summary,indent=2)+'\n')
    (out/'held-review-events.json').write_text(json.dumps(rejected,indent=2)+'\n')
    cards = ''.join('<article data-search="'+html.escape(' '.join(r['candidate_addresses']+[p['name'] for p in r['reported_places']]+[o['organization'] for o in r['source_evidence_candidates']]).lower(),quote=True)+'"><h3>'+html.escape(' / '.join(r['candidate_addresses']) or 'Address unresolved')+'</h3><p>'+html.escape(r['building_id'])+'</p><p>Reported places: '+html.escape(', '.join(p['name'] for p in r['reported_places']) or 'None linked')+'</p><p>New source observations: '+str(len(r['source_evidence_candidates']))+' · Individual review: '+html.escape(r['investigation_status'])+'</p><p>Next: '+html.escape(r['next_action'])+'</p></article>' for r in ledger)
    (out/'index.html').write_text('<!doctype html><meta charset="utf-8"><title>Windsor building research ledger</title><style>body{max-width:1100px;margin:30px auto;background:#101b28;color:#edf5ff;font:16px system-ui;padding:20px}article{padding:16px;border-bottom:1px solid #567}a{color:#72dfcb}input{padding:12px;width:90%}</style><h1>Windsor: building-by-building research</h1><p>'+html.escape(summary['limits'])+'</p><p>'+str(len(ledger))+' target outlines · '+str(summary['with_source_candidate'])+' with candidate source links · individually reviewed counts require recorded checks.</p><p><a href="../windsor-address-pilot-20261029/map.html">Map</a> · <a href="buildings.jsonl">Full ledger</a></p><input id="search" placeholder="Search an address or reported business" aria-label="Search buildings"><p id="count"></p>'+cards+'<script>const q=document.getElementById("search"),cards=[...document.querySelectorAll("article")];q.oninput=()=>{let n=0;for(const c of cards){c.hidden=!c.dataset.search.includes(q.value.toLowerCase());if(!c.hidden)n++}document.getElementById("count").textContent=n+" building outlines shown"};q.oninput();</script>')
    write_review_browser(ledger, out)
    print(json.dumps(summary,indent=2))


if __name__ == '__main__': build()
