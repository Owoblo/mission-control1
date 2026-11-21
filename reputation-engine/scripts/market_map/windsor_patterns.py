"""Cross-source research patterns; shared text never establishes identity or occupancy."""
import collections
import hashlib
import html
import json
from pathlib import Path
from .windsor_address_investigation import comparison_address
from .windsor_evidence_inventory import name_key
from .windsor_physical_report import ROOT


def compact(row):
    return {key: row.get(key) for key in ('organization','address','unit_or_floor','relationship',
        'source_url','checked_on','publication_date','announced_opening_date','status',
        'raw_evidence_reference','review_notes','published_contact_channels')}


def patterns(observations):
    by_address, by_name, by_channel = collections.defaultdict(list), collections.defaultdict(list), collections.defaultdict(list)
    for o in observations:
        by_address[comparison_address(o['address'])].append(o)
        by_name[name_key(o['organization'])].append(o)
        for c in o.get('published_contact_channels', []):
            if c['type'] in ('phone','email'):
                # Deliberately conservative; retain formatting variants for later review.
                by_channel[(c['type'], c['value'].strip().casefold())].append(o)
    address_reviews, name_reviews, contact_reviews = [], [], []
    for address, rows in sorted(by_address.items()):
        names = {name_key(o['organization']) for o in rows}
        if len(names) < 2: continue
        address_reviews.append({'review_id': hashlib.sha256(('address:'+address).encode()).hexdigest()[:20],
            'comparison_address': address, 'distinct_name_strings': len(names),
            'source_observations': [compact(o) for o in rows],
            'interpretation': 'Shared address evidence: may be separate tenants, a parent/branch, aliases, professional teams or occupant changes. No current co-occupancy or common ownership asserted.',
            'action': 'Check suites, source dates, operator pages and any explicit move/closure evidence before resolving.'})
    for name, rows in sorted(by_name.items()):
        addresses = {comparison_address(o['address'] + (' '+o['unit_or_floor'] if o.get('unit_or_floor') else '')) for o in rows}
        if len(addresses) < 2: continue
        name_reviews.append({'review_id': hashlib.sha256(('name:'+name).encode()).hexdigest()[:20],
            'comparison_name': name, 'distinct_address_strings': len(addresses),
            'source_observations': [compact(o) for o in rows],
            'interpretation': 'Same name at differing address text; could be branches, relocation, formatting or unrelated organizations. No automatic move or identity merge.',
            'action': 'Resolve identity and effective dates; preserve earlier source observations.'})
    for (kind, value), rows in sorted(by_channel.items()):
        names = {name_key(o['organization']) for o in rows}
        if len(names) < 2: continue
        # Same observation can list the same channel with multiple labels.
        unique = {(o['source_url'],o['organization'],o['address'],o.get('unit_or_floor')): o for o in rows}
        contact_reviews.append({'review_id': hashlib.sha256((kind+':'+value).encode()).hexdigest()[:20],
            'channel_type': kind, 'channel_value': value, 'distinct_name_strings': len(names),
            'source_observations': [compact(o) for o in unique.values()],
            'interpretation': 'Shared published contact channel, not proof of common ownership or one decision-maker.',
            'action': 'Identify channel scope: reception, call centre, manager, parent group or stale listing. Avoid duplicate contact until scope is established.'})
    return {'shared_address_reviews': address_reviews, 'same_name_multiple_address_reviews': name_reviews,
            'shared_contact_channel_reviews': contact_reviews}


def build():
    source = ROOT/'artifacts/windsor-address-investigation-20261029'
    observations = json.loads((source/'website-evidence-reconciliation.json').read_text())
    result = patterns(observations)
    result['summary'] = {name: len(rows) for name,rows in result.items()}
    result['summary'].update({'input_observations':len(observations),'confirmed_ownership_from_patterns':0,
        'confirmed_occupant_changes_from_patterns':0,'database_writes':0,'outreach_activated':False,
        'scope':'Text-level evidence patterns only; not new entities, verified conflicts or current tenancy determinations.'})
    (source/'pattern-reviews.json').write_text(json.dumps(result,indent=2))
    sections=[]
    labels={'shared_address_reviews':'Several names at one address',
            'same_name_multiple_address_reviews':'Same name, different addresses',
            'shared_contact_channel_reviews':'Shared business contact channels'}
    for category,title in labels.items():
        cards=[]
        for review in result[category]:
            heading=review.get('comparison_address') or review.get('comparison_name') or review.get('channel_type','')+': '+review.get('channel_value','')
            rows=''.join('<tr><td>'+html.escape(o['organization'])+'</td><td>'+html.escape(o['address']+(' · '+o['unit_or_floor'] if o.get('unit_or_floor') else ''))+'</td><td>'+html.escape(o.get('checked_on') or 'Check date not supplied')+'</td><td><a href="'+html.escape(o['source_url'],quote=True)+'">Source</a></td></tr>' for o in review['source_observations'])
            cards.append('<article><h3>'+html.escape(heading)+'</h3><table>'+rows+'</table><p>'+html.escape(review['interpretation'])+'</p><p>'+html.escape(review['action'])+'</p></article>')
        sections.append('<h2>'+title+' ('+str(len(cards))+')</h2>'+''.join(cards))
    (source/'patterns.html').write_text('<!doctype html><meta charset="utf-8"><title>Windsor evidence patterns</title><style>body{background:#101b28;color:#edf5ff;font:16px system-ui;max-width:1200px;margin:35px auto;padding:20px}article{background:#20374d;border-radius:12px;padding:20px;margin:18px 0}table{width:100%}td{padding:10px;border-bottom:1px solid #587080}a{color:#72dfcb}p{line-height:1.6}</style><h1>Windsor: patterns worth investigating</h1><p><a href="progress.html">Progress and remaining work</a> · <a href="index.html">Map and investigations</a></p><p>These are research clues. A shared address, name or telephone number does not prove common ownership, a current tenant, or a move. Source observations remain separate.</p>'+''.join(sections))
    print(json.dumps(result['summary'],indent=2))


if __name__ == '__main__': build()
