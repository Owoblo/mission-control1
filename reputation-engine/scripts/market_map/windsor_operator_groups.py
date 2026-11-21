"""Retain publisher-supported portfolio relationships without inferring ownership."""
import hashlib
import html
from html.parser import HTMLParser
import json
from pathlib import Path
from .windsor_physical_report import ROOT


class VisibleText(HTMLParser):
    def __init__(self):
        super().__init__(); self.skip = 0; self.parts = []
    def handle_starttag(self, tag, attrs):
        if tag in ('script', 'style'): self.skip += 1
    def handle_endtag(self, tag):
        if tag in ('script', 'style'): self.skip = max(0, self.skip - 1)
    def handle_data(self, data):
        if not self.skip and data.strip(): self.parts.append(data.strip())


def build():
    specs = [
        ('Maggio Group', 'https://www.maggiogroup.com/', '/private/tmp/windsor-maggio-group.html', [
            ("Vito's Pizzeria", '1731 Wyandotte St. E', None),
            ('Ortona 1864 Cafe & Panino', '1864 Wyandotte St. E', None),
            ('Factory House Sports Bar', '5240 Tecumseh Rd E.', None),
            ("O'Maggio's Kildare House", '1880 Wyandotte St. E', None),
            ("Nauti V's Oyster Bar", '1850 Wyandotte St. E', None),
            ("Vito's on Ouellette", '375 Ouellette Ave', None)]),
        ('F&B Hospitality Group', 'https://www.fandbhospitalitygroup.com/home', '/private/tmp/windsor-fb-group.html', [
            ('I know the owner - Tiki', '2090 Wyandotte Street E', 'lower'),
            ('The Grand Cantina', '1968 Wyandotte Street E', None),
            ('Taloola Cafe', '396 Devonshire Road', None),
            ('Funky Chow Kitchen', '2090 Wyandotte Street E', 'Lower')])]
    output = ROOT / 'artifacts/windsor-operator-groups-20261029'; output.mkdir(exist_ok=True)
    groups, observations = [], []
    for name, url, path, venues in specs:
        body = Path(path).read_bytes(); parser = VisibleText(); parser.feed(body.decode())
        text = '\n'.join(parser.parts)
        group_id = hashlib.sha256(url.encode()).hexdigest()[:20]
        raw = output / (group_id + '.html'); raw.write_bytes(body)
        edges = []
        for venue, address, unit in venues:
            if venue not in text or address not in text:
                raise ValueError('Source changed; manually review portfolio assertion')
            edges.append({'relationship_id': hashlib.sha256((url+venue+address).encode()).hexdigest()[:20],
                'group': name, 'venue': venue, 'address': address, 'unit_or_floor': unit,
                'relationship_type': 'listed_in_group_published_portfolio',
                'source_url': url, 'checked_on': '2026-10-29',
                'legal_ownership_verified': False, 'property_ownership_verified': False,
                'individual_decision_maker_verified': False})
            observations.append({'organization': venue, 'address': address, 'unit_or_floor': unit,
                'relationship': 'Listed on '+name+' portfolio page; legal entity/property ownership unverified',
                'source_url': url, 'status': 'group_published_venue_address_supported',
                'checked_on': '2026-10-29', 'raw_evidence_reference': str(raw.relative_to(ROOT)),
                'group_id': group_id, 'group_name': name})
        groups.append({'group_id': group_id, 'name': name, 'source_url': url,
            'sha256': hashlib.sha256(body).hexdigest(), 'raw_evidence_reference': str(raw.relative_to(ROOT)),
            'venues': edges, 'distinct_published_street_addresses': len({v[1] for v in venues}),
            'research_next': 'Verify who coordinates facilities, maintenance and furniture/equipment movement across these venues; do not infer the owner or invent a personal contact.',
            'outreach_eligible': False})
    evidence_path = Path(__file__).with_name('windsor_address_evidence.json')
    evidence = json.loads(evidence_path.read_text())
    sources = {s[1] for s in specs}
    evidence['observations'] = [o for o in evidence['observations'] if o['source_url'] not in sources] + observations
    evidence_path.write_text(json.dumps(evidence, indent=2)+'\n')
    result = {'groups': groups, 'group_count': len(groups), 'venue_relationships': len(observations),
              'licence': 'Internal factual research; no established bulk reuse licence; raw pages not publicly republished.',
              'net_new_verified_organizations': None, 'database_writes': 0}
    (output / 'relationships.json').write_text(json.dumps(result, indent=2))
    cards = []
    for group in groups:
        rows = ''.join('<tr><td>'+html.escape(e['venue'])+'</td><td>'+html.escape(e['address']+(' · '+e['unit_or_floor'] if e['unit_or_floor'] else ''))+'</td></tr>' for e in group['venues'])
        cards.append('<section><h2>'+html.escape(group['name'])+'</h2><p>'+str(len(group['venues']))+' listed venues · '+str(group['distinct_published_street_addresses'])+' street addresses</p><table>'+rows+'</table><p><a href="'+group['source_url']+'">Group-published evidence</a></p><p>'+html.escape(group['research_next'])+'</p></section>')
    (output / 'index.html').write_text('<!doctype html><meta charset="utf-8"><title>Windsor group relationships</title><style>body{background:#101b28;color:#edf5ff;font:17px system-ui;max-width:1000px;margin:35px auto;padding:20px}section{background:#20374d;padding:22px;margin:20px 0;border-radius:12px}td{padding:10px;border-bottom:1px solid #587080}a{color:#72dfcb}p{line-height:1.6}</style><h1>One group, several venues</h1><p><a href="../windsor-address-investigation-20261029/index.html">Back to Windsor investigations</a></p><p>These groups list these venues themselves. This establishes a published portfolio connection—not legal ownership, ownership of the buildings, or a named decision-maker. Two venues can share one street address.</p>'+''.join(cards))
    print(json.dumps({k:v for k,v in result.items() if k != 'groups'}, indent=2))


if __name__ == '__main__': build()
