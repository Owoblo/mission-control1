"""Extract current public listing detail facts and named-agent phone evidence."""
import json
from pathlib import Path
import re
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'partnership-system/state/november-revival-20261117/online-open-houses'
contacts = json.loads((OUT.parent / 'market_contacts.json').read_text())
phone = lambda s: re.sub(r'\D', '', str(s or ''))[-10:]
rows = []
for path in OUT.glob('detail-*.json'):
    saved = json.loads(path.read_text())
    raw, candidate = saved['result'], saved['candidate']
    text = re.sub(r'^L\d+: ?', '', raw, flags=re.M)
    url = re.search(r'\((https://www\.realtor\.ca/real-estate/[^\s)]+)\)', raw)
    crawl = re.search(r'Crawled: ([^;]+)', raw)
    section = re.search(r'## Open Houses\s*(.*?)(?=##|$)', text, re.S)
    events = []
    if section:
        for event in re.finditer(r'\bNov\s+(\d{1,2})\s*(?:【[^】]*】\s*)?([\d:., AMPamp–—-]+)', section.group(1)):
            day, time = int(event.group(1)), event.group(2).strip()
            if 17 <= day <= 30 and re.search(r'\d', time):
                events.append({'date': '2026-11-%02d' % day, 'time_displayed': time, 'year_basis': 'current November display and recent crawl; year not explicit in event block'})
    agents = []
    headers = list(re.finditer(r'【\d+†([^】]+?)\s+(Salesperson|Sales Representative|Broker of Record|Broker|Real Estate Agent|REALTOR(?:\^?\{?®\}?)?)】', text, re.I))
    for i, match in enumerate(headers):
        if match.group(1).strip().lower() in {'contact', 'find a', 'find', 'ask a'}:
            continue
        tail = text[match.end():headers[i + 1].start() if i + 1 < len(headers) else len(text)]
        tail = re.split(r'【\d+†[^】]*Brokerage', tail, maxsplit=1, flags=re.I)[0]
        numbers = re.findall(r'\b\d{3}[- .]\d{3}[- .]\d{4}\b', tail)
        agents.append({'name': match.group(1), 'role': match.group(2), 'direct_phone_displayed': numbers[0] if numbers else None,
                       'phone_type': 'not_verified', 'host_role': 'not_verified'})
    current = bool(url and crawl and crawl.group(1) in {'today', 'yesterday', '2 days ago'} and events and candidate['mls'] in text)
    matches = []
    if current:
        for a in agents:
            for c in contacts:
                if a['direct_phone_displayed'] and phone(c['phone']) == phone(a['direct_phone_displayed']):
                    matches.append({'contact_id': c['id'], 'name': c['name'], 'city': c['city'], 'phone': c['phone'],
                                    'source_agent': a['name'], 'state': 'full_live_conversation_and_identity_review_required',
                                    'suppressed_in_saved_index': bool(c.get('do_not_contact') or c.get('cross_channel_suppressed_at'))})
    rows.append({'mls': candidate['mls'], 'address': candidate['address'], 'detail_url': url.group(1) if url else None,
                 'crawl_age': crawl.group(1) if crawl else None, 'open_house_events': events, 'associated_agents': agents,
                 'current_detail_signal': current, 'crm_phone_matches': matches, 'evidence_file': path.name,
                 'observed_at': saved['at'], 'outreach_eligible': False, 'confirmed_sale': False})
report = {'detail_pages_checked': len(rows), 'current_detail_signals': sum(r['current_detail_signal'] for r in rows),
          'unique_crm_phone_matches': len({m['contact_id'] for r in rows for m in r['crm_phone_matches']}),
          'rows': rows}
(OUT / 'verified-detail-signals.json').write_text(json.dumps(report, indent=2))
print(json.dumps({k: v for k, v in report.items() if k != 'rows'}))
