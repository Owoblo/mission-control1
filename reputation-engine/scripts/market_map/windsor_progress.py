"""Measured research progress and public-contact observations, not market completeness."""
import collections
import csv
from datetime import datetime, timezone
import html
import json
from pathlib import Path
from .windsor_address_pilot import address_key
from .windsor_physical_report import ROOT


def build():
    out = ROOT / 'artifacts/windsor-address-investigation-20261029'
    summary = json.loads((out/'summary.json').read_text())
    observations = json.loads((out/'website-evidence-reconciliation.json').read_text())
    queued = [json.loads(line) for line in (out/'address-investigations.jsonl').read_text().splitlines()]
    inventory = json.loads((out/'existing-inventory-comparison.json').read_text())['summary']
    batch = json.loads((ROOT/'artifacts/windsor-downtown-addresses-20261029/summary.json').read_text())
    receipts = json.loads((ROOT/'artifacts/windsor-downtown-addresses-20261029/receipts.json').read_text())
    property_data = json.loads((ROOT/'artifacts/windsor-property-evidence-20261029/evidence.json').read_text())
    groups = json.loads((ROOT/'artifacts/windsor-operator-groups-20261029/relationships.json').read_text())
    roles_path = ROOT/'artifacts/windsor-professional-role-evidence-20261029/roles.json'
    roles = json.loads(roles_path.read_text()) if roles_path.exists() else {'named_people_with_primary_source_role_evidence': 0}
    walkerville = set()
    for receipt in (ROOT/'artifacts').glob('windsor-parallel-walkerville-*/integration-receipt.json'):
        batch_summary = receipt.parent/'summary.json'
        if batch_summary.exists():
            ws = json.loads(batch_summary.read_text())
            walkerville.update(ws.get('cumulative_address_supported_roster_indices', []))
            walkerville.update(ws.get('cumulative_windsor_address_supported_indices', []))
    register_path = ROOT/'artifacts/windsor-role-register-20261029/roles.json'
    register = json.loads(register_path.read_text())['summary'] if register_path.exists() else {}
    contacts = []
    for o in observations:
        for c in o.get('published_contact_channels', []):
            contacts.append({'organization': o['organization'], 'address_context': o['address'],
                'type': c['type'], 'value': c['value'], 'scope': c['scope'],
                'source_url': o['source_url'], 'checked_on': o.get('checked_on'),
                'named_person_verified': False, 'decision_authority_verified': False,
                'communication_eligibility': 'not_assessed', 'outreach_eligible': False})
    for c in property_data['contacts']:
        for kind in ('email','phone'):
            contacts.append({'organization': c['organization'], 'address_context': c['office_address'],
                'type': kind, 'value': c[kind], 'scope': c['published_role']+'; '+c['scope'],
                'source_url': property_data['properties'][0]['source_url'], 'checked_on': c['checked_on'],
                'named_person_verified': False, 'decision_authority_verified': False,
                'communication_eligibility': 'not_assessed', 'outreach_eligible': False})
    # Department contacts stay institution-wide, never copied to every campus or invented person.
    from .windsor_batch_merge import validate_reference, validate_contacts
    for receipt in (ROOT/'artifacts').glob('windsor-parallel-*/integration-receipt.json'):
        department_path = receipt.parent/'professional-roles.json'
        if not department_path.exists():
            continue
        for department in json.loads(department_path.read_text()):
            validate_reference(department)
            validate_contacts(department)
            for c in department.get('published_contact_channels', []):
                contacts.append({'organization': department['organization'],
                    'address_context': department.get('published_office_location') or department.get('street_address') or '',
                    'type': c['type'], 'value': c['value'], 'scope': c['scope'],
                    'source_url': department['source_url'], 'checked_on': department.get('checked_on'),
                    'named_person_verified': False, 'decision_authority_verified': False,
                    'communication_eligibility': 'not_assessed', 'outreach_eligible': False})
    facts = {'checked_at': datetime.now(timezone.utc).isoformat(),
        'existing_inventory_locations': inventory['existing_windsor_locations'],
        'displayed_building_features': 139074,
        'research_candidate_building_features': summary['expanded_map_research_features'],
        'queued_address_strings': len(queued),
        'queue_rows_with_website_address_evidence': sum('website_address_evidence' in q['roles'] for q in queued),
        'queue_rows_without_new_website_address_evidence': sum('website_address_evidence' not in q['roles'] for q in queued),
        'source_observations': len(observations),
        'distinct_case_whitespace_normalized_observation_addresses': len({address_key(o['address']+(' · '+o['unit_or_floor'] if o.get('unit_or_floor') else '')) for o in observations}),
        'observations_with_candidate_buildings': sum(bool(o['candidate_building_ids']) for o in observations),
        'observations_without_candidate_buildings': sum(not o['candidate_building_ids'] for o in observations),
        'contact_channel_observations': len(contacts),
        'distinct_exact_type_value_channels': len({(c['type'], c['value']) for c in contacts}),
        'contact_observations_by_type': dict(collections.Counter(c['type'] for c in contacts)),
        'named_decision_makers_verified_in_this_contact_batch': 0,
        'named_people_with_primary_source_role_evidence': roles['named_people_with_primary_source_role_evidence'],
        'parallel_batch_professional_role_observations': register.get('role_observations', 0),
        'parallel_batch_role_records_held': register.get('held', 0),
        'hospitality_portfolio_relationships': groups['venue_relationships'],
        'property_portfolio_relationships': property_data['property_count'],
        'source_policy_holds': len(property_data['source_policy_holds']),
        'downtown_source_rows': batch['source_leads'],
        'downtown_address_observations': batch['address_observations'],
        'downtown_source_rows_held_or_excluded': batch['held_for_review'],
        'downtown_source_rows_remaining_unchecked': batch['remaining_unchecked'],
        'downtown_http_pages_checked': sum(r.get('http_status')=='200' for r in receipts.values()),
        'walkerville_roster_total': 109,
        'walkerville_address_supported_leads': len(walkerville),
        'walkerville_remaining_address_checks': 109-len(walkerville),
        'database_writes': 0, 'outreach_activated': False,
        'net_new_verified_organizations': None, 'whole_city_completeness_percent': None,
        'limits': 'Counts describe this research checkpoint. Address strings can be variants, suites or one property; building features can be roof sections. A source observation is not a verified unique company. Existing inventory and new observations overlap. Unchecked queue rows can already contain other source evidence. Public contacts are not verified decision-makers or automatic permission to contact.'}
    (out/'progress.json').write_text(json.dumps(facts, indent=2))
    (out/'public-contact-observations.json').write_text(json.dumps(contacts, indent=2))
    if contacts:
        with (out/'public-contact-observations.csv').open('w', newline='') as f:
            writer = csv.DictWriter(f, fieldnames=list(contacts[0])); writer.writeheader(); writer.writerows(contacts)
    metrics = [('Existing Windsor location records', facts['existing_inventory_locations']),
        ('Building outlines in research view', facts['research_candidate_building_features']),
        ('Address entries in research queue', facts['queued_address_strings']),
        ('Queue entries with this new source-address evidence', facts['queue_rows_with_website_address_evidence']),
        ('Queue entries still without this new source-address evidence', facts['queue_rows_without_new_website_address_evidence']),
        ('Saved source observations', facts['source_observations']),
        ('Observations with a candidate building match', facts['observations_with_candidate_buildings']),
        ('Observations still without a candidate building match', facts['observations_without_candidate_buildings']),
        ('Published contact-channel observations', facts['contact_channel_observations']),
        ('Distinct exact contact channels (not people)', facts['distinct_exact_type_value_channels']),
        ('Named decision-makers verified in this contact batch', 0),
        ('People with a source-supported professional role (current authority unverified)', facts['named_people_with_primary_source_role_evidence']),
        ('Additional professional-role observations from integrated batches', facts['parallel_batch_professional_role_observations']),
        ('Professional-role observations awaiting schema/source review', facts['parallel_batch_role_records_held']),
        ('Hospitality portfolio connections', facts['hospitality_portfolio_relationships']),
        ('Property portfolio connections', facts['property_portfolio_relationships']),
        ('Walkerville leads with supported addresses', facts['walkerville_address_supported_leads']),
        ('Walkerville leads still needing address support', facts['walkerville_remaining_address_checks']),
        ('Downtown pages with address evidence', facts['downtown_address_observations']),
        ('Downtown roster rows still unchecked', facts['downtown_source_rows_remaining_unchecked'])]
    rows = ''.join('<tr><td>'+html.escape(label)+'</td><td>'+format(n,',')+'</td></tr>' for label,n in metrics)
    contact_rows = ''.join('<tr><td>'+html.escape(c['organization'])+'</td><td>'+html.escape(c['type'])+'</td><td>'+html.escape(c['value'])+'</td><td>'+html.escape(c['scope'])+'</td><td><a href="'+html.escape(c['source_url'],quote=True)+'">Source</a></td></tr>' for c in contacts)
    (out/'progress.html').write_text('<!doctype html><meta charset="utf-8"><title>Windsor research progress</title><style>body{background:#101b28;color:#edf5ff;font:16px system-ui;max-width:1200px;margin:30px auto;padding:20px}table{width:100%;border-collapse:collapse}td{padding:12px;border-bottom:1px solid #40576b;overflow-wrap:anywhere}a{color:#72dfcb}p{line-height:1.6}</style><h1>Windsor: what we know and what is left</h1><p><a href="index.html">Map and investigations</a> · <a href="../windsor-building-ledger-20261029/index.html">Building-by-building progress</a> · <a href="../windsor-property-evidence-20261029/index.html">Property evidence</a> · <a href="public-contact-observations.csv">Contact evidence CSV</a> · <a href="patterns.html">Address and relationship clues</a> · <a href="../windsor-role-register-20261029/index.html">Parallel research: professional roles</a> · <a href="../windsor-professional-role-evidence-20261029/index.html">People and role evidence</a></p><table>'+rows+'</table><p>'+html.escape(facts['limits'])+'</p><h2>Remaining work</h2><p>Continue the bounded Downtown roster, resolve the remaining Walkerville leads shown above, match unresolved source addresses, and investigate occupants at queued locations. Add commercial occupants, departments, managers, contractors and public business contacts when evidence supports each relationship. Single-location organizations remain in scope. No whole-city completion percentage is claimed.</p><p>Portfolio patterns are a research aid, not a replacement for broad coverage. Owner, operator, manager, leasing agent, commercial tenant and contractor remain separate roles. No private residential tenants or leases are collected.</p><h2>Published business contact observations</h2><p>These are source-listed channels; some are shared by several places. Nobody has been contacted.</p><table>'+contact_rows+'</table><p>Checkpoint: '+facts['checked_at']+'</p>')
    print(json.dumps(facts, indent=2))


if __name__ == '__main__': build()
