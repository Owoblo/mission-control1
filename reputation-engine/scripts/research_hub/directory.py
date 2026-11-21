"""Read-only realtor directory context, separate from CRM relationship history."""
import csv
import gzip
import hashlib
import json
from pathlib import Path
import re


def norm(value):
    return re.sub(r'[^a-z0-9]', '', str(value or '').lower())


def phone_key(value):
    digits = re.sub(r'\D', '', str(value or ''))
    return digits[1:] if len(digits) == 11 and digits.startswith('1') else digits


def saved_routes(observations):
    phones, emails = set(), set()
    for row in observations:
        for field in ('phone','phone2','phone3','website_phones'):
            for value in str(row.get(field) or '').split('|'):
                number=phone_key(value)
                if len(number)==10:phones.add(number)
        for field in ('email','website_emails'):
            for value in re.split(r'[|;,\s]+',str(row.get(field) or '')):
                if '@' in value:emails.add(value.strip().lower())
    return {'phones':phones,'emails':emails}


def build(files, output):
    records = {}
    sources = []
    for filename in files:
        path = Path(filename)
        sha = hashlib.sha256(path.read_bytes()).hexdigest()
        sources.append({'file': path.name, 'sha256': sha})
        with path.open(encoding='utf-8-sig', newline='') as handle:
            for row in csv.DictReader(handle):
                if not row.get('name'):
                    continue
                identity = 'realtor.ca:' + row['individual_id'] if row.get('individual_id') else 'unresolved:' + hashlib.sha256(
                    json.dumps([path.name, row], sort_keys=True).encode()).hexdigest()
                observation = {k: row.get(k) or None for k in (
                    'name','brokerage','phone','phone2','phone3','email','website','profile_url',
                    'email_source','email_attribution','extra_phone_attribution','collected_at_utc','enriched_at_utc',
                    'website_emails','website_phones','enrichment_sources')}
                observation['source_file'] = path.name
                observation['source_file_sha256'] = sha
                records.setdefault(identity, []).append(observation)
    payload = {'schema_version': 'realtor-directory-context/1.0', 'sources': sources, 'records': records,
               'note': 'Historical directory observations, not verified current routes or proof of CRM relationship.'}
    output = Path(output); output.parent.mkdir(parents=True, exist_ok=True)
    with gzip.open(output, 'wt', encoding='utf-8') as out:
        json.dump(payload, out, separators=(',', ':'))
    return {'identities': len(records), 'observations': sum(map(len, records.values())), 'sources': sources}


class Directory:
    def __init__(self, path=None, data=None):
        self.available = False
        self.by_name = {}
        self.records = {}
        self.phone_owners = {}
        self.size = 0
        if data is None:
            path = Path(path or Path(__file__).with_name('realtor-directory.json.gz'))
            if not path.exists():
                return
            with gzip.open(path, 'rt', encoding='utf-8') as handle:
                data = json.load(handle)
        for identity, observations in data['records'].items():
            self.records[identity] = observations
            for observation in observations:
                self.by_name.setdefault(norm(observation['name']), []).append((identity, observation))
                for field in ('phone', 'phone2', 'phone3'):
                    number = phone_key(observation.get(field))
                    if len(number) == 10:
                        self.phone_owners.setdefault(number, set()).add(identity)
        self.size = len(data['records'])
        self.available = True

    def route_inventory(self, identity):
        observations = self.records[identity]
        numbers = {phone_key(row.get(k)) for row in observations for k in ('phone','phone2','phone3')}
        numbers = sorted(n for n in numbers if len(n) == 10)
        unique = [n for n in numbers if len(self.phone_owners.get(n, set())) == 1]
        return {'saved_numbers': numbers, 'shared_numbers': [n for n in numbers if n not in unique],
                'numbers_unique_in_saved_directory': unique,
                'direct_number_verified': False,
                'needs_number_research': not unique,
                'unique_is_not_proof_of_direct_ownership': True}

    def match(self, representative):
        if not self.available:
            return {'state': 'directory_unavailable', 'identities': [], 'observations': []}
        named = self.by_name.get(norm(representative.get('name')), [])
        matched = [(identity, row) for identity, row in named if norm(representative.get('brokerage'))
                   and norm(row.get('brokerage')) == norm(representative['brokerage'])]
        identities = sorted({identity for identity, _ in matched})
        if len(identities) == 1:
            return {'state': 'existing_directory_candidate', 'identities': identities,
                    'observations': [row for _, row in matched], 'identity_basis': 'exact_name_and_brokerage',
                    'routes_are_current_verified': False}
        return {'state': 'identity_review' if named else 'no_directory_match',
                'identities': sorted({identity for identity, _ in named}),
                'observations': [row for _, row in named]}


def context(rep, contacts_result, directory):
    matched = directory.match(rep)
    if contacts_result['state'] == 'existing_candidate':
        category = 'existing_crm_candidate'
    elif matched['state'] == 'existing_directory_candidate':
        category = 'existing_directory_candidate'
    elif contacts_result['state'] == 'crm_unavailable' or matched['state'] == 'directory_unavailable':
        category = 'incomplete_existing_record_check'
    elif contacts_result['state'] == 'ambiguous' or matched['state'] == 'identity_review':
        category = 'identity_review'
    else:
        category = 'not_found_in_available_records'
    previous=saved_routes(matched['observations'])
    previous_emails,previous_phones = previous['emails'],previous['phones']
    crm_details = contacts_result.get('existing_contact_details') or {}
    previous_emails.add(str(crm_details.get('email') or '').lower())
    previous_phones.add(phone_key(crm_details.get('phone')))
    # These are possible additions, never replacements or send-ready routes.
    additions = {}
    if rep.get('email') and rep['email'].lower() not in previous_emails:
        additions['email_candidate'] = rep['email']
    if rep.get('phone') and phone_key(rep['phone']) not in previous_phones:
        additions['phone_candidate'] = rep['phone']
    return {'category': category, 'crm': contacts_result, 'directory': matched,
            'possible_contact_additions': additions, 'outreach_eligible': False}
