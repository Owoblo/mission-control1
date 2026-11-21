"""Build private, paused launch batches. No credentials, imports or sending.

Changing --daily-cap rebuilds a planning scenario, never a live queue.
"""
import argparse
import csv
import hashlib
import heapq
import json
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--daily-cap', type=int, choices=(2000, 3000), default=2000)
parser.add_argument('--start-date', type=date.fromisoformat, default=date(2026, 9, 28))
args = parser.parse_args()
root = Path('deliverables/gta-launch-20260926')
source = root / 'candidates-after-crm-check.csv'
rows = list(csv.DictReader(source.open(encoding='utf-8', newline='')))
assert len({r['normalized_primary_phone'] for r in rows}) == len(rows), 'Duplicate phone'
assert len({r['individual_id'] for r in rows}) == len(rows), 'Duplicate source identity'
assert all(r['sequence_paused'].lower() == 'true' for r in rows), 'Unexpected active source'
groups = defaultdict(list)
for row in rows:
    groups[row['crm_city']].append(row)
# Evenly interleave municipalities by their share of the pool; stable per-person order.
heap = []
for city, group in groups.items():
    group.sort(key=lambda r: hashlib.sha256(r['individual_id'].encode()).hexdigest())
    heapq.heappush(heap, (0.5 / len(group), city, 0))
ordered = []
while heap:
    _, city, index = heapq.heappop(heap)
    ordered.append(groups[city][index])
    index += 1
    if index < len(groups[city]):
        heapq.heappush(heap, ((index + 0.5) / len(groups[city]), city, index))
out = root / 'batches' / str(args.daily_cap)
out.mkdir(parents=True, exist_ok=True)
fields = ['source_key', 'individual_id', 'name', 'first_name', 'crm_city',
          'normalized_primary_phone', 'partnership_number', 'profile_url',
          'source_file_sha256', 'planned_at', 'sequence_paused', 'release_status']
days = []
for offset in range(0, len(ordered), args.daily_cap):
    day = args.start_date + timedelta(days=offset // args.daily_cap)
    batch = ordered[offset:offset + args.daily_cap]
    start = datetime.combine(day, datetime.min.time(), ZoneInfo('America/Toronto')).replace(hour=10)
    target = out / f'{day.isoformat()}.csv'
    with target.open('w', encoding='utf-8', newline='') as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        for index, row in enumerate(batch):
            # Partial final days retain the same cadence; never compress at closing.
            planned = start + timedelta(seconds=index * 7 * 3600 / args.daily_cap)
            writer.writerow({**{key: row.get(key, '') for key in fields},
                             'source_key': 'realtor-ca:' + row['individual_id'],
                             'planned_at': planned.isoformat(), 'sequence_paused': 'true',
                             'release_status': 'held_pending_eligibility_and_live_controls'})
    days.append({'date': day.isoformat(), 'contacts': len(batch),
                 'cities': dict(sorted(Counter(r['crm_city'] for r in batch).items())),
                 'one_segment_budget_usd': [round(len(batch)*rate, 2) for rate in (.00908, .012845)],
                 'responses_at_10_percent_target': round(len(batch)*.1),
                 'file_sha256': hashlib.sha256(target.read_bytes()).hexdigest()})
manifest = {'status': 'offline_preparation_only', 'daily_cap': args.daily_cap,
            'weekends_included': True, 'timezone': 'America/Toronto',
            'proposed_window': '10:00–17:00, subject to staffed coverage',
            'candidate_count': len(rows), 'source_sha256': hashlib.sha256(source.read_bytes()).hexdigest(),
            'sender': '+14374650584', 'reply_owner': 'John; backup and coverage unconfirmed',
            'live_daily_cap_changed': False, 'imported': 0, 'queued': 0, 'sent': 0,
            'holds': ['recipient capability and consent evidence', 'final compliant copy and segment count',
                      'fresh CRM suppression and conversation reconciliation',
                      'source-ID-aware paused import', 'live scheduler/worker/database cap alignment',
                      'delivery pilot and staffed reply coverage'],
            'days': days}
(out / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
print(json.dumps({'daily_cap': args.daily_cap, 'candidates': len(rows), 'days': len(days),
                  'last_date': days[-1]['date'], 'sent': 0, 'manifest': str(out / 'manifest.json')}))
