"""Pinned local consolidation plan for completed staged source snapshots.

Building/preflighting a plan never opens the canonical database. Intake remains
open: add a later completed cohort by creating a new plan revision. A completed
source snapshot does not establish a complete market or a unique-company count.
"""
from __future__ import annotations

import argparse
from contextlib import contextmanager
import fcntl
import hashlib
import importlib
import inspect
import json
import os
import shutil
import sqlite3
from pathlib import Path

from .store import stamp

MINIMUM_FREE = 2 * 1024**3
VERSION = 'completed-cohort-plan/1'

# Adapter names are explicit local calls, never arbitrary commands/imports from
# an untrusted JSON plan. Missing source-specific normalizers stay visible.
ADAPTERS = {
    'provider_places': ('scripts.market_map.place_import', 'import_collections', {'batch_size': 500}),
    'civic_locations': ('scripts.market_map.civic_sources', 'apply_civic_acquisition', {'batch_size': 250}),
    'commercial_properties': ('scripts.market_map.commercial_properties', 'apply_commercial_acquisition', {}),
    'toronto_licences': ('scripts.market_map.toronto_full', 'apply_acquisition', {'batch_size': 500}),
    'middlesex_directory': ('scripts.market_map.regional_west', 'apply_western_acquisition', {'batch_size': 250}),
    'childcare': ('scripts.market_map.childcare_sources', 'apply_childcare_acquisition', {'batch_size': 250}),
    'north_grenville': ('scripts.market_map.eastern_rosters', 'apply_eastern_acquisition', {'batch_size': 250}),
    'kanata_north': ('scripts.market_map.eastern_bia', 'apply_bia_acquisition', {'batch_size': 250}),
    'named_sections': ('scripts.market_map.eastern_sources', 'apply_named_sections', {}),
}
ADAPTERS['york_selected_facts'] = ('scripts.market_map.factual_promotion', 'apply_york_acquisition', {'batch_size': 500})
for _kind in ['halton_historical', 'hamilton_chamber', 'mcahn', 'bild', 'ajax_pickering', 'bloor_west', 'downtown_yonge', 'milton_bia', 'burlington_bia']:
    ADAPTERS['local_' + _kind] = ('scripts.market_map.local_fact_promotion', 'apply_local_acquisition', {'kind': _kind, 'batch_size': 250})
for _kind in ['elgin', 'listowel', 'tillsonburg', 'guelph_bia']:
    ADAPTERS['western_' + _kind] = ('scripts.market_map.western_fact_promotion', 'apply_western_facts', {'kind': _kind, 'batch_size': 250})
ADAPTERS['toronto_context_only'] = ('scripts.market_map.context_event_promotion', 'apply_context_acquisition', {'batch_size': 500})


def digest(path):
    value = hashlib.sha256()
    with Path(path).open('rb') as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b''):
            value.update(block)
    return value.hexdigest()


def atomic(path, value):
    path = Path(path)
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')
    temporary.replace(path)


def input_files(folder):
    """Pin originals, normalized rows and rights/proofs, excluding run journals."""
    excluded = {'acquisition-status.json', 'checkpoint.json', 'README.txt', 'README.md'}
    return sorted(path for path in Path(folder).rglob('*') if path.is_file()
                  and path.name not in excluded and not path.name.endswith(('.tmp', '.log')))


def _specs(root):
    """Only completed, reviewed snapshots belong here; partial jobs are absent."""
    result = []
    def add(key, folder, primary, unit, observations, *, adapter=None, candidates=None, raw_only=0, notes='', source_keys=None):
        path = root / folder / primary
        if not path.exists():
            return
        result.append({'cohort_id': key, 'folder': root / folder, 'primary': path,
                       'record_unit': unit, 'input_observations': observations,
                       'candidate_rows': candidates, 'raw_only_or_history_rows': raw_only,
                       'unique_source_keys': source_keys, 'adapter': adapter, 'notes': notes})
    add('provider-wave4-net-new', 'map-promotion-ready', 'promotion-summary.json',
        'new GERS place identities from pinned release; includes non-organisation places', 92376,
        adapter='provider_places', candidates=92376, source_keys=92376,
        notes='All566241 acquired observations retained in19 immutable archives and line/hash ledger;92376 new IDs only enter canonical provider map. Baseline395352 plus92376 becomes487728; not unique-company counts.')
    add('toronto-full-licences', 'toronto-licences-full-next-release', 'manifest.json',
        'licence/permit observation; not unique or verified current business', 160102,
        adapter='toronto_licences', candidates=37499, raw_only=122603,
        notes='All160102 original rows preserved.122599 cancelled +4 quarantined rows stay raw/history, never active-company candidates. Historical placeholder/source rows remain auditable.')
    for key, count in [('ontario-moh-service-locations', 11625), ('ontario-opp-locations', 99),
                       ('ontario-court-locations', 79), ('ontario-library-locations', 354)]:
        add(key, 'civic-acquisition/' + key, 'manifest.json', 'institutional service/office/site observation; not a legal-company or building count',
            count, adapter='civic_locations', candidates=count,
            notes='Address roles, historical dates, source identifiers and explicit commands preserved; no owner/operator/property inference.')
    for key, observations, properties in [('ottawa-maintained-facilities', 768, 596),
                                          ('canada-crown-ontario-assets', 731, 257), ('sifton-commercial', 2, 2)]:
        add(key, 'commercial-property-acquisition/' + key, 'manifest.json', 'property/asset/facility observation',
            observations, adapter='commercial_properties', candidates=0, source_keys=properties,
            notes='Source property contexts, not organisations/sites per row. Atomic bounded source snapshots; preserve all observation periods and explicit portfolio roles without current ownership claims.')
    add('middlesex-directory', 'western-regional-acquisition/middlesex-offered-export', 'manifest.json',
        'offered CSV directory listing observation', 2089, adapter='middlesex_directory', candidates=2089,
        notes='2088 distinct full rows plus one repeated observation preserved.1804 street/address candidates;285 lack address. Internal offered factual-export rights only.')
    add('childcare-provincewide', 'eastern-acquisition/childcare-provincewide', 'manifest.json',
        'statutory child-care licence/program observation; centre and agency roles separate', 8722,
        adapter='childcare', candidates=6353, raw_only=2369,
        notes='September2026 reference snapshot;6353 Active/ON account candidates,2367 Inactive plus2Active/QC raw-only. Preserve all8722 rows/leading-zero licences. Agency address is not a provider home; no owner/operator inference.')
    add('north-grenville-directory', 'eastern-acquisition/north-grenville-directory', 'manifest.json',
        'directory listing appearance; unique profile key not unique legal company', 800,
        adapter='north_grenville', candidates=800, source_keys=800,
        notes='743 published native IDs +57 explicit profile-URL fallbacks.583 printed address candidates. Separate74-row wrong-scope native-link probe remains external raw evidence, not74 new companies.')
    add('kanata-north-directory', 'eastern-acquisition/kanata-north-bia', 'manifest.json',
        'BIA directory listing; all identities explicitly content-derived', 528,
        adapter='kanata_north', candidates=528, source_keys=528,
        notes='53 pages/528 source rows,498 printed address candidates,522 source websites,15 uncategorized rows retained; no publisher-native ID or current occupancy claim.')
    add('municipal-named-sections', 'eastern-acquisition/municipal-named-sections', 'manifest.json',
        'named entity with finite source-listed business-park/employer role', 30,
        adapter='named_sections', candidates=30, source_keys=30,
        notes='18 Mississippi Mills park-listed names +12 Carleton Place major-employer names; no physical locations, employee counts, owner or tenant inference.')
    # Completed raw cohorts awaiting their source-specific promotion adapters.
    pending = [
        ('york-directory-2024', 'york-2024-publisher-html-acquisition', 'manifest.json', 29863, 29863, 0, 'licensed historical2024 directory listing; not current company/site verification'),
        ('halton-hills-directory', 'halton-hills-factual-acquisition', 'manifest.json', 1442, 1442, 0, 'historical2021/carry-forward directory observation; parser must retain unknown legal-name/site claims'),
        ('hamilton-chamber', 'hamilton-chamber-factual-acquisition', 'preferred-normalization.json', 811, 811, 0, 'member-directory observation; MUST use derived-parser2 preferred normalization, original remains immutable'),
        ('mcahn-construction', 'mcahn-construction-factual-acquisition', 'preferred-normalization.json', 61, 61, 0, 'business/associate membership facts; preferred parser normalization required'),
        ('bild-construction', 'bild-construction-factual-acquisition', 'preferred-normalization.json', 932, 932, 0, 'business membership source facts; MUST use preferred snapshot-qualified record keys, original preserved'),
        ('ajax-pickering-board', 'ajax-pickering-board-factual-acquisition', 'manifest.json', 507, 505, 2, '505 company-member facts;2 explicit individual IDs excluded without names;13 hidden-address flags must remain honored'),
        ('elgin-directory', 'western-regional-acquisition/internal-factual-rosters/elgin/factual-snapshot', 'manifest.json', 2540, 941, 0, '2540 appearances across29 exact queries;941 native profile keys, not2540 companies'),
        ('listowel-bia', 'western-regional-acquisition/listowel-bia-factual-snapshot', 'manifest.json', 281, 280, 1, '281 native WixUUID rows; blank-name row raw-only;183 unknown category fields retained'),
        ('bloor-west-bia', 'toronto-bia-factual-acquisition/bloor-west', 'manifest.json', 362, 362, 0, 'published directory observation; current membership/company/site status unverified'),
        ('downtown-yonge-bia', 'toronto-bia-factual-acquisition/downtown-yonge-public-api', 'manifest.json', 628, 628, 0, '628 native public directory IDs; selected minimal facts only'),
        ('downtown-milton-bia', 'downtown-milton-bia-public-api-acquisition', 'manifest.json', 174, 174, 0, '174 native public directory IDs; source-specific roles and raw unknowns retained'),
        ('burlington-downtown-bia', 'burlington-downtown-bia-public-api-acquisition', 'manifest.json', 383, 383, 0, '383 native public directory IDs; name/profile/category only, no footer-derived city/site/website'),
        ('tillsonburg-directory', 'western-regional-acquisition/tillsonburg-factual-snapshot', 'manifest.json', 932, 932, 0, '932 native profiles; MUST prefer source-evidence-annotated-factual-listings.jsonl.gz, zero employee/year/size placeholders remain unknown, NAICS version unknown'),
        ('london-role-separated', 'western-regional-acquisition/london-open-facility-raw', 'manifest.json', 35, None, 35, '5 BIA boundarycontexts +13 golf area features +17 library point/site candidates; never35 companies/buildings'),
        ('toronto-dinesafe-events', 'toronto-civic-raw-acquisition/dinesafe', 'manifest.json', 123643, 0, 123643, 'inspection/infraction event rows; raw archive preserved, not company rows'),
        ('toronto-bodysafe-events', 'toronto-civic-raw-acquisition/bodysafe', 'manifest.json', 14730, 0, 14730, 'inspection/infraction event rows; raw archive preserved, not company rows'),
        ('toronto-bia-boundaries', 'toronto-civic-raw-acquisition/business-improvement-areas', 'manifest.json', 86, 0, 86, 'BIA boundary/association records; raw contexts, not member-company rows'),
    ]
    for key, folder, primary, observations, candidates, raw_only, notes in pending:
        add(key, folder, primary, notes, observations, candidates=candidates, raw_only=raw_only, notes='Completed frozen source; source-specific promotion adapter pending. ' + notes)
    return result


def _extra_inputs(spec):
    """Known out-of-folder originals that reviewed local adapters reference."""
    path, folder = spec['primary'], spec['folder']
    manifest = json.loads(path.read_text())
    extras = []
    if spec['adapter'] == 'provider_places':
        for collection in folder.glob('*/collection.json'):
            data = json.loads(collection.read_text())
            original = Path(data['metadata']['original_source_manifest'])
            original_data = json.loads(original.read_text())
            extras += [original, original.parent / original_data['rows_file']]
    if spec['adapter'] == 'named_sections':
        for group in manifest['cohorts']:
            receipts = [Path(group['original_receipt']), *[Path(item['receipt']) for item in group['rights_evidence']]]
            for receipt in receipts:
                value = json.loads(receipt.read_text())
                extras += [receipt, receipt.parent / value['file']]
    if spec['adapter'] == 'kanata_north':
        receipt = Path(manifest['inspection_receipt'])
        extras += [receipt, receipt.parent / json.loads(receipt.read_text())['file']]
        for identifier in ['policy-8fced23622e37147', 'policy-8ee16074ff05c55b']:
            source = receipt.parent / (identifier + '.receipt.json')
            extras += [source, source.parent / json.loads(source.read_text())['file']]
    if spec['cohort_id'] == 'elgin-directory':
        # Snapshot's query receipts point to its completed sibling raw receipt set.
        extras.extend(input_files(folder.parent / 'private-receipts'))
        rights = folder.parent / 'rights-review.json'
        if rights.exists(): extras.append(rights)
    return extras


def build_plan(run_root, output):
    root, output = Path(run_root).resolve(), Path(output).resolve()
    existing_parent = output
    while not existing_parent.exists():
        existing_parent = existing_parent.parent
    if shutil.disk_usage(existing_parent).free < MINIMUM_FREE:
        raise RuntimeError('Minimum2GiB free required; completed source snapshots remain untouched')
    output.mkdir(parents=True, exist_ok=True)
    artifacts, stages = {}, []
    for spec in _specs(root):
        primary_data = json.loads(spec['primary'].read_text())
        status = primary_data.get('status')
        if status and any(word in status.casefold() for word in ('partial', 'running', 'blocked', 'permission', 'restricted')):
            raise ValueError('An active/partial/held cohort cannot enter completed plan: ' + spec['cohort_id'])
        files = [*input_files(spec['folder']), *_extra_inputs(spec)]
        references = []
        if any(Path(p).is_symlink() for p in files) or spec['folder'].is_symlink():
            raise ValueError('Completed source inputs must not be symlinks')
        for path in sorted(set(Path(p).resolve() for p in files)):
            if not path.is_relative_to(root) or not path.is_file() or path.is_symlink():
                raise ValueError('Completed input is missing or outside frozen run: ' + str(path))
            key = str(path.relative_to(root))
            if key not in artifacts:
                artifacts[key] = {'path': str(path), 'bytes': path.stat().st_size, 'sha256': digest(path)}
            references.append(key)
        adapter = spec['adapter']
        if adapter:
            module, function, kwargs = ADAPTERS[adapter]
            module_path = Path(__file__).resolve().parents[2] / (module.replace('.', '/') + '.py')
            adapter_call = {'registry_key': adapter, 'module': module, 'function': function, 'kwargs': kwargs,
                            'source_module_path': str(module_path), 'source_module_sha256': digest(module_path)}
        else:
            adapter_call = None
        stages.append({'cohort_id': spec['cohort_id'], 'status': 'ready_for_assigned_writer' if adapter else 'completed_snapshot_adapter_pending',
                       'source_folder': str(spec['folder']), 'primary_manifest': str(spec['primary']),
                       'primary_manifest_sha256': digest(spec['primary']), 'record_unit': spec['record_unit'],
                       'input_observations': spec['input_observations'], 'candidate_rows': spec['candidate_rows'],
                       'raw_only_or_history_rows': spec['raw_only_or_history_rows'], 'unique_source_keys': spec['unique_source_keys'],
                       'unique_company_count': None, 'market_completeness_verified': False, 'notes': spec['notes'],
                       'artifact_keys': references, 'adapter_call': adapter_call})
    plan = {'schema_version': 1, 'version': VERSION, 'created_at': stamp(), 'run_root': str(root),
            'status': 'reviewable_completed_cohort_consolidation_plan', 'main_database_opened_or_mutated': False,
            'intake_frozen': False, 'active_partial_restricted_cohorts_included': False,
            'execution_requires_root_assigned_writer_after_passed_read_only_audit': True,
            'minimum_free_bytes_per_stage_and_import_batch': MINIMUM_FREE,
            'baseline_provider_source_id': 'overture-2026-10-21.0', 'baseline_provider_keys': 395352,
            'provider_keys_after_net_new_promotion': 487728,
            'already_loaded_baseline_excluded_from_reimport': {'organisations': 647616, 'locations': 637557, 'raw_records': 715734,
                'provider_keys': 395352, 'cra_charity_source_keys': 30570, 'odbus_source_keys': 205122,
                'note': 'Checkpoint counts, to be reconciled with the new read-only loaded-base audit before assigning a writer. These are provisional observations/entities, not verified unique companies.'},
            'stages': stages, 'artifacts': artifacts,
            'readiness_counts': {'ready_adapters': sum(s['adapter_call'] is not None for s in stages),
                                 'completed_snapshots_adapter_pending': sum(s['adapter_call'] is None for s in stages)},
            'raw_retention_policy': 'All raw originals/history/rejected rows stay immutable and pinned. Candidate adapters never manufacture companies from cancelled, blank-name, person-only, geometry-context or event rows. Archive-only/pending adapters remain explicit.',
            'completion_policy': 'Completing this plan means only its assigned ready import subset. Pending source adapters and the open discovery frontier prevent a full raw-market-collection completion claim.'}
    audit_path = root / 'finalisation/loaded-base-readiness-audit.bound.json'
    if audit_path.exists():
        audit = json.loads(audit_path.read_text())
        if (audit.get('passed') is not True or audit.get('integrity_check') != 'ok'
                or audit.get('provider_unique_ids_loaded') != plan['baseline_provider_keys']):
            raise ValueError('Available baseline audit is not the passed planned loaded-base audit')
        key = str(audit_path.relative_to(root))
        artifacts[key] = {'path': str(audit_path), 'bytes': audit_path.stat().st_size, 'sha256': digest(audit_path)}
        plan['baseline_read_only_audit'] = {'path': str(audit_path), 'sha256': digest(audit_path),
            'integrity_check': audit['integrity_check'], 'provider_keys': audit['provider_unique_ids_loaded'], 'passed': True,
            'database_path': audit.get('database_path')}
    canonical = json.dumps({k: v for k, v in plan.items() if k != 'created_at'}, sort_keys=True, ensure_ascii=False)
    plan['plan_id'] = hashlib.sha256(canonical.encode()).hexdigest()
    atomic(output / 'plan.json', plan)
    report = preflight(output / 'plan.json')
    atomic(output / 'preflight.json', report)
    return plan, report


def preflight(plan_path):
    """Read-only filesystem/hash verification; no SQLite constructor or network."""
    plan = json.loads(Path(plan_path).read_text())
    errors, checked_bytes = [], 0
    if plan.get('version') != VERSION or plan.get('active_partial_restricted_cohorts_included') is not False:
        errors.append('Plan schema/completed-cohort restriction differs')
    canonical = json.dumps({k: v for k, v in plan.items() if k not in {'created_at', 'plan_id'}}, sort_keys=True, ensure_ascii=False)
    if hashlib.sha256(canonical.encode()).hexdigest() != plan.get('plan_id'):
        errors.append('Plan content digest differs; rebuild a reviewed revision')
    for key, artifact in plan.get('artifacts', {}).items():
        path = Path(artifact['path'])
        if path.is_symlink() or not path.is_file():
            errors.append({'artifact': key, 'error': 'Missing/symlink input'})
            continue
        if path.stat().st_size != artifact['bytes'] or digest(path) != artifact['sha256']:
            errors.append({'artifact': key, 'error': 'Frozen input size/SHA256 differs'})
        checked_bytes += path.stat().st_size
    for stage in plan.get('stages', []):
        call = stage.get('adapter_call')
        if not call:
            continue
        expected = ADAPTERS.get(call['registry_key'])
        if not expected or (call['module'], call['function'], call['kwargs']) != expected:
            errors.append({'cohort': stage['cohort_id'], 'error': 'Adapter call differs from reviewed registry'})
        module = Path(call['source_module_path'])
        if not module.is_file() or digest(module) != call['source_module_sha256']:
            errors.append({'cohort': stage['cohort_id'], 'error': 'Adapter source changed; create/review a new plan revision'})
    for dependency in plan.get('code_dependencies', []):
        path = Path(dependency['path'])
        if path.is_symlink() or not path.is_file() or digest(path) != dependency['sha256']:
            errors.append({'dependency': dependency['path'], 'error': 'Reviewed dependency/config source changed'})
    if plan.get('audit_lineage'):
        try:
            from .continuation import validate_lineage
            validate_lineage(plan)
        except Exception as exc:
            errors.append({'lineage': type(exc).__name__ + ': ' + str(exc)})
    return {'checked_at': stamp(), 'plan_id': plan.get('plan_id'), 'passed': not errors, 'errors': errors,
            'artifacts_checked': len(plan.get('artifacts', {})), 'input_bytes_checked': checked_bytes,
            'canonical_database_opened_or_mutated': False, 'network_requests': 0,
            'ready_import_stages': sum(bool(s.get('adapter_call')) for s in plan.get('stages', [])),
            'completed_snapshots_adapter_pending': sum(not s.get('adapter_call') for s in plan.get('stages', [])),
            'market_completeness_verified': False}


class ConsolidationStoragePaused(RuntimeError):
    pass


def _space(directory):
    available = shutil.disk_usage(directory).free
    if available < MINIMUM_FREE:
        raise ConsolidationStoragePaused('Storage pause before transaction: free_bytes=' + str(available) + '; required=' + str(MINIMUM_FREE))
    return available


def _source_ids(stage, result=None):
    data = json.loads(Path(stage['primary_manifest']).read_text())
    found = set()
    if stage['adapter_call']['registry_key'] == 'provider_places':
        found.add('overture-' + data['provider_release'])
    def walk(value):
        if isinstance(value, dict):
            if isinstance(value.get('source_id'), str): found.add(value['source_id'])
            if isinstance(value.get('source'), dict) and value['source'].get('id'): found.add(value['source']['id'])
            for child in value.values():
                if isinstance(child, (dict, list)): walk(child)
        elif isinstance(value, list):
            for child in value: walk(child)
    walk(data)
    walk(result)
    return sorted(found)


def _run_receipts(store, sources):
    if not sources:
        raise RuntimeError('Completed adapter supplied no auditable source identity')
    placeholders = ','.join('?' for _ in sources)
    records = store.db.execute('SELECT id,source_id,fingerprint,status,result_json FROM source_runs WHERE source_id IN (' + placeholders + ") AND status NOT IN ('running','failed','error','blocked') ORDER BY id", sources)
    receipts = [{'run_id': row['id'], 'source_id': row['source_id'], 'fingerprint': row['fingerprint'],
                 'status': row['status'], 'result_sha256': hashlib.sha256((row['result_json'] or '').encode()).hexdigest()} for row in records]
    if not receipts:
        raise RuntimeError('No committed source-run replay receipts after adapter return')
    return receipts


def _verify_completed_receipt(store, entry):
    path = Path(entry['receipt_file'])
    if not path.is_file() or digest(path) != entry['receipt_sha256']:
        raise RuntimeError('Completed cohort receipt checksum differs')
    receipt = json.loads(path.read_text())
    for item in receipt['committed_source_runs']:
        row = store.db.execute('SELECT source_id,fingerprint,status,result_json FROM source_runs WHERE id=?', (item['run_id'],)).fetchone()
        if (not row or row['source_id'] != item['source_id'] or row['fingerprint'] != item['fingerprint']
            or row['status'] != item['status'] or hashlib.sha256((row['result_json'] or '').encode()).hexdigest() != item['result_sha256']):
            raise RuntimeError('Committed source-run replay receipt differs; verify canonical database before resuming')


def execute_plan(plan_path, database_path, *, state_path, audit_receipt, writer_assignment=None, only=None, progress=None):
    """Run only after explicit root writer assignment and passed base audit.

    No constructor, migration or canonical write happens before all gates pass.
    Every store transaction gets a fresh2GiB guard in addition to each adapter's
    own guards. SIGINT preserves committed batches; rerun the exact same plan
    and checkpoint to replay those batches and resume the interrupted cohort.
    """
    if not isinstance(writer_assignment, str) or not writer_assignment.strip():
        raise RuntimeError('Root sole-writer assignment is required; main database remains closed')
    plan_path, database_path, state_path, audit_path = map(lambda p: Path(p).resolve(), (plan_path, database_path, state_path, audit_receipt))
    plan = json.loads(plan_path.read_text())
    audit = json.loads(audit_path.read_text())
    expected_audit_provider = (plan.get('audit_lineage') or {}).get('original_audit_provider_keys', plan['baseline_provider_keys'])
    if (audit.get('passed') is not True or audit.get('integrity_check') != 'ok' or audit.get('provider_count_matches') is not True
        or audit.get('provider_unique_ids_loaded') != expected_audit_provider):
        raise RuntimeError('Passed read-only baseline integrity/provider audit required; main database remains closed')
    if audit.get('database_path') and Path(audit['database_path']).resolve() != database_path:
        raise RuntimeError('Audit receipt belongs to another database')
    if plan.get('audit_lineage'):
        lineage = plan['audit_lineage']
        if audit_path != Path(lineage['original_audit']['path']).resolve() or digest(audit_path) != lineage['original_audit']['sha256']:
            raise RuntimeError('Continuation must retain its exact original full-audit lineage receipt')
    report = preflight(plan_path)
    if not report['passed']:
        raise RuntimeError('Frozen input/adapter preflight failed before database open: ' + json.dumps(report['errors']))
    if not database_path.is_file():
        raise RuntimeError('Audited canonical database must already exist; no new database created')
    ready = {s['cohort_id']: s for s in plan['stages'] if s.get('adapter_call')}
    if only and (set(only) - ready.keys()):
        raise RuntimeError('Requested cohort lacks a reviewed ready adapter: ' + ','.join(sorted(set(only) - ready.keys())))
    selected = [s for s in plan['stages'] if s['cohort_id'] in ready and (not only or s['cohort_id'] in only)]
    _space(database_path.parent)
    existing = state_path.parent
    while not existing.exists(): existing = existing.parent
    _space(existing)
    state_path.parent.mkdir(parents=True, exist_ok=True)
    state = json.loads(state_path.read_text()) if state_path.exists() else {
        'schema_version': 1, 'plan_id': plan['plan_id'], 'database_path': str(database_path),
        'created_at': stamp(), 'cohorts': {s['cohort_id']: {'status': 'pending' if s.get('adapter_call') else 'adapter_pending'} for s in plan['stages']}}
    if state['plan_id'] != plan['plan_id'] or state['database_path'] != str(database_path):
        raise RuntimeError('Checkpoint belongs to a different plan/database; preserve it and use a new revision checkpoint')
    lock_path = database_path.with_suffix(database_path.suffix + '.consolidation.lock')
    with lock_path.open('a+') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError('Another consolidation writer holds this database lock') from None
        lock.seek(0); lock.truncate(); lock.write(json.dumps({'pid': os.getpid(), 'plan_id': plan['plan_id'], 'writer_assignment': writer_assignment, 'started_at': stamp()})); lock.flush()
        if state.get('error'):
            state.setdefault('stop_history', []).append({'status': state.get('status'), 'error': state['error'],
                'at': state.get('paused_at') or state.get('failed_at')})
        for old in ['error', 'failed_at', 'paused_at', 'completed_at']:
            state.pop(old, None)
        state.update(status='running', started_or_resumed_at=stamp(), writer_assignment=writer_assignment,
                     audit_receipt=str(audit_path), audit_receipt_sha256=digest(audit_path),
                     market_completeness_verified=False, production_crm_mutations=0, network_requests_by_runner=0)
        atomic(state_path, state)
        def event_journal(event):
            with (state_path.parent / 'progress.jsonl').open('a') as log:
                log.write(json.dumps({'at': stamp(), **event}, ensure_ascii=False) + '\n')
                log.flush()
            if progress: progress(event)
        current = None
        from .store import MarketMap
        from .place_import import StoragePaused
        try:
            # Validate actual source state with mode=ro before migrations/opening
            # a writable connection, including interrupted-plan resume ranges.
            readonly = sqlite3.connect(database_path.as_uri() + '?mode=ro', uri=True)
            try:
                readonly.row_factory = sqlite3.Row
                if plan.get('audit_lineage'):
                    from .continuation import validate_current_baseline
                    baseline = validate_current_baseline(readonly, plan, state)
                    state.update(baseline_state_validated=True, baseline_validation=baseline)
                    atomic(state_path, state)
                before = readonly.execute('SELECT COUNT(*) FROM source_identities WHERE source_id=?', (plan['baseline_provider_source_id'],)).fetchone()[0]
            finally:
                readonly.close()
            if not plan['baseline_provider_keys'] <= before <= plan['provider_keys_after_net_new_promotion']:
                raise RuntimeError('Loaded provider count outside planned baseline..target; no writable constructor opened')
            with MarketMap(str(database_path)) as store:
                ordinary_transaction = store.transaction
                @contextmanager
                def guarded_transaction():
                    _space(database_path.parent)
                    with ordinary_transaction(): yield
                store.transaction = guarded_transaction
                provider_count = store.db.execute('SELECT COUNT(*) FROM source_identities WHERE source_id=?', (plan['baseline_provider_source_id'],)).fetchone()[0]
                if not plan['baseline_provider_keys'] <= provider_count <= plan['provider_keys_after_net_new_promotion']:
                    raise RuntimeError('Loaded provider count outside planned baseline..target; verify before importing')
                for stage in selected:
                    current = state['cohorts'][stage['cohort_id']]
                    if current['status'] == 'completed':
                        _verify_completed_receipt(store, current)
                        continue
                    _space(database_path.parent)
                    current.update(status='running', started_or_resumed_at=stamp())
                    state['active_cohort_id'] = stage['cohort_id']
                    atomic(state_path, state)
                    def checkpoint(event):
                        current.update(last_progress=event, last_progress_at=stamp())
                        atomic(state_path, state)
                        event_journal({'cohort_id': stage['cohort_id'], **event})
                        _space(database_path.parent)
                    call = stage['adapter_call']
                    function = getattr(importlib.import_module(call['module']), call['function'])
                    kwargs = dict(call['kwargs'])
                    if 'progress' in inspect.signature(function).parameters:
                        kwargs['progress'] = checkpoint
                    result = function(store, Path(stage['source_folder']), **kwargs)
                    if call['registry_key'] == 'provider_places':
                        actual = store.db.execute('SELECT COUNT(*) FROM source_identities WHERE source_id=?', (plan['baseline_provider_source_id'],)).fetchone()[0]
                        if actual != plan['provider_keys_after_net_new_promotion']:
                            raise RuntimeError('Provider promotion returned before exact planned target was reconciled')
                    receipt = {'plan_id': plan['plan_id'], 'cohort_id': stage['cohort_id'], 'completed_at': stamp(),
                               'adapter_result': result, 'committed_source_runs': _run_receipts(store, _source_ids(stage, result)),
                               'record_unit': stage['record_unit'], 'unique_company_count': None,
                               'replay_semantics': 'Adapter reports may contain original run insertion counts when replayed; replay flags are authoritative. Do not sum them as new companies.',
                               'market_completeness_verified': False}
                    receipt_path = state_path.parent / (stage['cohort_id'] + '.replay-receipt.json')
                    atomic(receipt_path, receipt)
                    current.update(status='completed', completed_at=receipt['completed_at'], receipt_file=str(receipt_path),
                                   receipt_sha256=digest(receipt_path), committed_run_receipts=len(receipt['committed_source_runs']))
                    atomic(state_path, state)
                    event_journal({'cohort_id': stage['cohort_id'], 'status': 'completed'})
            pending = [key for key, item in state['cohorts'].items() if item['status'] != 'completed']
            state.update(status='ready_import_subset_completed' if pending else 'all_planned_completed_cohorts_imported',
                         remaining_cohort_ids=pending, completed_at=stamp(), active_cohort_id=None,
                         raw_collection_complete=False, intake_frozen=False)
        except (ConsolidationStoragePaused, StoragePaused) as exc:
            if current: current['status'] = 'storage_paused'
            state.update(status='storage_paused', error=str(exc), paused_at=stamp())
        except KeyboardInterrupt:
            if current: current['status'] = 'interrupted'
            state.update(status='interrupted', error='SIGINT/KeyboardInterrupt; committed batches retained, in-flight transaction rolled back', paused_at=stamp())
        except Exception as exc:
            if current: current['status'] = 'error'
            state.update(status='error', error=type(exc).__name__ + ': ' + str(exc), failed_at=stamp())
        atomic(state_path, state)
        return state


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--run-root', type=Path)
    parser.add_argument('--output', type=Path)
    parser.add_argument('--preflight', type=Path)
    parser.add_argument('--execute', type=Path, help='Reviewed plan.json; root must explicitly assign writer after passed audit')
    parser.add_argument('--database', type=Path)
    parser.add_argument('--state', type=Path)
    parser.add_argument('--audit-receipt', type=Path)
    parser.add_argument('--writer-assignment')
    parser.add_argument('--only', nargs='+')
    args = parser.parse_args()
    if args.execute:
        if not all([args.database, args.state, args.audit_receipt, args.writer_assignment]):
            parser.error('--execute requires --database, --state, --audit-receipt and explicit --writer-assignment')
        result = execute_plan(args.execute, args.database, state_path=args.state, audit_receipt=args.audit_receipt,
                              writer_assignment=args.writer_assignment, only=args.only,
                              progress=lambda event: print(json.dumps(event), flush=True))
        print(json.dumps(result), flush=True)
        if result['status'] not in {'ready_import_subset_completed', 'all_planned_completed_cohorts_imported'}:
            raise SystemExit(130 if result['status'] == 'interrupted' else 1)
    elif args.preflight:
        print(json.dumps(preflight(args.preflight)), flush=True)
    elif args.run_root and args.output:
        plan, report = build_plan(args.run_root, args.output)
        print(json.dumps({'plan_id': plan['plan_id'], **report}), flush=True)
    else:
        parser.error('Use --run-root/--output or --preflight plan.json')


if __name__ == '__main__': main()
