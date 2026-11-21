"""Evidence-scoped portfolios. Never equate portfolio absence with a sale."""
import datetime as dt
import json
import sqlite3
from collections import Counter
from pathlib import Path
from scripts.research_hub.listings import atomic, digest, now

PERSON_ROLES = {'listing_agent', 'co_listing_agent', 'leasing_agent', 'property_manager'}


def person_key(row):
    context = row.get('existing_record_context') or {}
    directory = context.get('directory') or {}
    ids = directory.get('identities') or []
    if directory.get('state') == 'existing_directory_candidate' and len(ids) == 1:
        return ids[0]
    crm = row.get('relationship') or {}
    if crm.get('state') == 'existing_candidate' and crm.get('contact_id'):
        return 'crm:' + crm['contact_id']
    return None  # Ambiguous identities are reviewed, never merged by name alone.


class Portfolios:
    def __init__(self, root):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(self.root / 'portfolios.sqlite3')
        self.db.row_factory = sqlite3.Row
        self.db.executescript('''PRAGMA journal_mode=WAL;
          CREATE TABLE IF NOT EXISTS snapshots (
            id TEXT PRIMARY KEY, person TEXT, source TEXT, scope TEXT, observed_at TEXT,
            imported_at TEXT, complete INTEGER, payload TEXT);
          CREATE TABLE IF NOT EXISTS events (
            id TEXT PRIMARY KEY, person TEXT, kind TEXT, observed_at TEXT,
            snapshot_id TEXT, payload TEXT);
        ''')

    def ingest(self, snapshot):
        """Collector contract: one person's own inventory, one source, one scope.

        Complete requires explicit successful pagination and zero failed pages.
        Snapshots are ordered by observation time; late input is retained without
        producing backwards changes. Replay cannot produce duplicate events.
        """
        s = dict(snapshot)
        for field in ('person', 'source', 'scope', 'observed_at', 'listings'):
            if field not in s:
                raise ValueError('Missing snapshot field: ' + field)
        observed = dt.datetime.fromisoformat(s['observed_at'].replace('Z', '+00:00'))
        if observed.tzinfo is None or observed > dt.datetime.now(dt.timezone.utc) + dt.timedelta(minutes=5):
            raise ValueError('Observation must have timezone and cannot be in the future')
        s['observed_at'] = observed.astimezone(dt.timezone.utc).isoformat()
        if s.get('inventory_kind') != 'own':
            raise ValueError('Office inventory must not enter personal portfolio snapshots')
        complete = (s.get('complete') is True and s.get('pagination_complete') is True
                    and s.get('failed_pages') == 0 and s.get('fetch_state') == 'success'
                    and bool(s.get('source_url')))
        if s.get('complete') and not complete:
            raise ValueError('Complete scan requires successful pagination receipt and source URL')
        listings = s['listings']
        keys = [x['listing_key'] for x in listings]
        if len(set(keys)) != len(keys):
            raise ValueError('Duplicate listing identity in snapshot')
        s['listings'] = sorted(listings, key=lambda x: x['listing_key'])
        sid = digest(s)
        if self.db.execute('SELECT 1 FROM snapshots WHERE id=?', (sid,)).fetchone():
            return {'state': 'replay', 'events': 0}
        previous = self.db.execute('SELECT * FROM snapshots WHERE person=? AND source=? AND scope=? '
                                  'ORDER BY observed_at DESC,imported_at DESC LIMIT 1',
                                  (s['person'], s['source'], s['scope'])).fetchone()
        events = []
        if not previous:
            events.append(('baseline', {'listing_keys': keys}))
        elif s['observed_at'] > previous['observed_at']:
            # Accumulate observations since the latest complete snapshot. A
            # partial page must not erase previously observed members.
            prior = self.db.execute('SELECT * FROM snapshots WHERE person=? AND source=? AND scope=? '
                                   'ORDER BY observed_at DESC,imported_at DESC',
                                   (s['person'], s['source'], s['scope'])).fetchall()
            old = {}
            for saved in prior:
                for item in json.loads(saved['payload'])['listings']:
                    old.setdefault(item['listing_key'], item)
                if saved['complete']:
                    break
            current = {x['listing_key']: x for x in listings}
            for key in current.keys() - old.keys():
                events.append(('first_observed_in_portfolio', {'listing_key': key}))
            for key in current.keys() & old.keys():
                changes = {field: {'before': old[key].get(field), 'after': current[key].get(field)}
                           for field in ('price', 'source_status', 'lane', 'transaction_type', 'property_type')
                           if old[key].get(field) != current[key].get(field)}
                if changes:
                    events.append(('observed_fields_changed', {'listing_key': key, 'changes': changes}))
            if complete:
                for key in old.keys() - current.keys():
                    events.append(('not_shown_in_complete_scan', {'listing_key': key,
                                   'sold_or_leased_confirmed': False, 'verification_required': True}))
        with self.db:
            self.db.execute('INSERT INTO snapshots VALUES (?,?,?,?,?,?,?,?)',
                            (sid, s['person'], s['source'], s['scope'], s['observed_at'], now(), int(complete), json.dumps(s)))
            for kind, payload in events:
                eid = digest([sid, kind, payload])
                self.db.execute('INSERT INTO events VALUES (?,?,?,?,?,?)',
                                (eid, s['person'], kind, s['observed_at'], sid, json.dumps(payload)))
        return {'state': 'saved', 'events': len(events), 'complete': complete}

    def export_candidates(self, candidates, records):
        people, unresolved = {}, 0
        for row in candidates:
            if row.get('superseded') or row.get('episode_match') == 'different_listing_episode':
                continue
            if row.get('role') not in PERSON_ROLES:
                continue
            identity = person_key(row)
            if not identity:
                unresolved += 1
                continue
            person = people.setdefault(identity, {'person_id': identity, 'name': row['name'],
                         'relationship': row.get('relationship'), 'listings': {}})
            record = records.get(row['listing_key'], {})
            person['listings'][row['listing_key']] = {
                'listing_key': row['listing_key'], 'address': row.get('address'), 'city': row.get('city'),
                'unit': record.get('unit'), 'lane': row.get('lane'), 'price': record.get('price'),
                'property_identity': ((record.get('lane', '') + ':' + str(record['property_id']))
                                      if record.get('property_id') else None),
                'transaction_type': record.get('transaction_type', 'unknown'),
                'property_type': record.get('property_type', 'unknown'),
                'source_status': record.get('source_status'),
                'source_observed_at': record.get('source_observed_at'), 'research_at': row.get('research_at'),
                'representation_source_url': row.get('source_url'), 'role': row.get('role'),
                'temporal_scope': row.get('temporal_scope'), 'episode_match': row.get('episode_match'),
                'representation_verified': False, 'current_availability': 'not_confirmed',
                'mail_eligibility': 'not_evaluated', 'print_submission': 'not_connected'}
        results = []
        for identity, person in sorted(people.items()):
            items = list(person['listings'].values())
            person['listings'] = items
            person['observed_listing_records'] = len(items)
            person['by_lane'] = dict(Counter(x['lane'] for x in items))
            person['by_city'] = dict(Counter(x['city'] or 'unknown' for x in items))
            person['distinct_properties'] = None  # Cross-source/unit-safe resolution is not yet complete.
            person['portfolio_complete'] = False
            person['confirmed_active_count'] = None
            person['confirmed_sales_count'] = None
            person['outreach_eligible'] = False
            # Research export is a partial evidence feed, not a fresh source scan.
            evidence_time = max((r['research_at'] for r in items if r['research_at']), default=None)
            if evidence_time:
                self.ingest({'person': identity, 'source': 'listing_research', 'scope': 'all_observed_lanes',
                             'observed_at': evidence_time, 'inventory_kind': 'own', 'complete': False,
                             'observation_kind': 'research_evidence', 'listings': items})
            results.append(person)
        events = [dict(r) for r in self.db.execute('SELECT * FROM events ORDER BY observed_at DESC,id')]
        for event in events:
            event['payload'] = json.loads(event['payload'])
        report = {'schema_version': 'observed-portfolios/1.0', 'updated_at': now(), 'people': results,
                  'unresolved_person_connections': unresolved,
                  'coverage': 'Partial research candidates. Not a complete active portfolio or city census.',
                  'mail_and_print': 'Not connected; no fulfilment inferred from listing eligibility.'}
        atomic(self.root / 'portfolios.json', report)
        atomic(self.root / 'portfolio-events.json', events)
        return report
