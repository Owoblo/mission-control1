"""Reviewed17-cohort continuation with honest audit/committed-ingestion lineage.

The earlier full audit is retained as earlier evidence. A completed ingestion
reconciliation is never relabelled as a fresh full integrity audit. The writable
constructor stays closed until exact fresh baseline/source-state checks pass.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from types import SimpleNamespace

from .consolidation import ADAPTERS, VERSION, atomic, digest, input_files, preflight, _space
from .store import stamp


def _load(reference):
    path = Path(reference['path'])
    if path.is_symlink() or not path.is_file() or digest(path) != reference['sha256']:
        raise RuntimeError('Continuation lineage receipt bytes differ: ' + str(path))
    return json.loads(path.read_text())


def validate_lineage(plan):
    lineage = plan['audit_lineage']
    audit = _load(lineage['original_audit'])
    previous = _load(lineage['completed_plan'])
    state = _load(lineage['completed_state'])
    receipt = _load(lineage['completed_reconciliation'])
    if (audit.get('passed') is not True or audit.get('integrity_check') != 'ok'
        or audit.get('provider_count_matches') is not True
        or audit.get('provider_unique_ids_loaded') != lineage['original_audit_provider_keys']
        or previous.get('baseline_provider_keys') != lineage['original_audit_provider_keys']):
        raise RuntimeError('Original passed full-audit lineage is invalid')
    if (previous.get('plan_id') != state.get('plan_id') or state.get('status') not in {'ready_import_subset_completed', 'all_planned_completed_cohorts_imported'}
        or state.get('active_cohort_id') is not None):
        raise RuntimeError('Prior ingestion plan/state is not completed')
    ready = [s['cohort_id'] for s in previous['stages'] if s.get('adapter_call')]
    if len(ready) != lineage['completed_ready_stages'] or any(state['cohorts'][key]['status'] != 'completed' for key in ready):
        raise RuntimeError('Prior reviewed ready stages are not all completed')
    if (receipt.get('status') != 'completed_approved14_subset_receipts_and_source_counts_reconciled'
        or receipt.get('all_completed_replay_receipts_match_committed_run_fingerprints_and_result_hashes') is not True
        or receipt.get('completed_cohorts') != len(ready)
        or receipt.get('provider_count_matches') is not True
        or receipt.get('provider_expected_count') != plan['baseline_provider_keys']
        or previous.get('provider_keys_after_net_new_promotion') != plan['baseline_provider_keys']
        or receipt.get('source_identity_counts', {}).get(plan['baseline_provider_source_id']) != plan['baseline_provider_keys']
        or receipt.get('canonical_table_counts', {}).get('organisations') != plan['baseline_organisation_count']):
        raise RuntimeError('Completed ingestion reconciliation does not establish planned continuation baseline')
    if lineage.get('new_full_integrity_audit') is not False or receipt.get('full_post_consolidation_integrity_audit_run') is not False:
        raise RuntimeError('A committed-ingestion reconciliation cannot be relabelled as a fresh full audit')
    paths = [Path(v).resolve() for v in [audit.get('database_path'), state.get('database_path'), receipt.get('database_path')] if v]
    if not paths or any(p != paths[0] for p in paths):
        raise RuntimeError('Continuation lineage belongs to different databases')
    return state, receipt


def validate_current_baseline(connection, plan, state):
    from .consolidation import _verify_completed_receipt
    previous, reconciliation = validate_lineage(plan)
    if Path(reconciliation['database_path']).resolve() != Path(state['database_path']).resolve():
        raise RuntimeError('Continuation checkpoint database differs from reviewed lineage')
    # Recheck the actual previous committed records, not only files describing
    # them. This connection is URI mode=ro and cannot migrate/write anything.
    readonly_store = SimpleNamespace(db=connection)
    for old in previous['cohorts'].values():
        if old['status'] == 'completed': _verify_completed_receipt(readonly_store, old)
    provider = connection.execute('SELECT COUNT(*) FROM source_identities WHERE source_id=?', (plan['baseline_provider_source_id'],)).fetchone()[0]
    organisations = connection.execute('SELECT COUNT(*) FROM organisations').fetchone()[0]
    if provider != plan['baseline_provider_keys']:
        raise RuntimeError('Continuation provider count must remain exact; no writable constructor opened')
    baseline = plan['baseline_organisation_count']
    resuming = state.get('baseline_state_validated') is True
    if not resuming and organisations != baseline:
        raise RuntimeError('Fresh continuation organisation baseline differs; no writable constructor opened')
    if resuming:
        prior = state.get('baseline_validation') or {}
        if (prior.get('plan_id') != plan['plan_id'] or prior.get('initial_organisation_count') != baseline
            or prior.get('provider_count') != provider
            or not baseline <= organisations <= baseline + sum(s['candidate_rows'] or 0 for s in plan['stages'])):
            raise RuntimeError('Continuation resume state outside reviewed source/candidate bounds')
    source_counts = {}
    for source_id, expected in plan['baseline_source_identity_counts'].items():
        actual = connection.execute('SELECT COUNT(*) FROM source_identities WHERE source_id=?', (source_id,)).fetchone()[0]
        allowance = sum(s['candidate_rows'] or 0 for s in plan['stages'] if s['source_id'] == source_id) if resuming else 0
        if not expected <= actual <= expected + allowance:
            raise RuntimeError('Continuation source identity state differs: ' + source_id)
        source_counts[source_id] = actual
    return {'plan_id': plan['plan_id'], 'checked_at': stamp(), 'provider_count': provider,
            'organisation_count_at_check': organisations, 'initial_organisation_count': baseline,
            'source_identity_counts_at_check': source_counts, 'resuming': resuming,
            'database_open_mode': 'read_only', 'fresh_full_integrity_audit_claimed': False}


def build_continuation_plan(run_root, output):
    root, output = Path(run_root).resolve(), Path(output).resolve()
    _space(root)
    addendum_path = root / 'consolidation-plan/pending-adapters-ready-handoff.json'
    addendum = json.loads(addendum_path.read_text())
    if addendum.get('ready_additional_cohort_count') != 17 or len(addendum.get('cohorts', [])) != 17:
        raise RuntimeError('Only the exact reviewed17-stage addendum can enter this continuation')
    local_config = Path(__file__).parent / 'config/completed-local-factual-promotions.json'
    western_config = Path(__file__).parent / 'config/completed-western-factual-promotions.json'
    context_config = Path(__file__).parent / 'config/completed-toronto-context-promotions.json'
    local = json.loads(local_config.read_text())['source_cohorts']
    western = json.loads(western_config.read_text())['source_cohorts']
    contexts = json.loads(context_config.read_text())['cohorts']
    sources = {'york-business-directory-2024': ('york_selected_facts', None)}
    sources.update({s['source_id']: ('local_' + kind, s) for kind, s in local.items()})
    sources.update({s['source_id']: ('western_' + kind, s) for kind, s in western.items()})
    for name, spec in contexts.items():
        primary = root / 'toronto-civic-raw-acquisition' / name / 'manifest.json'
        sources[json.loads(primary.read_text())['source_id']] = ('toronto_context_only', spec)
    if set(sources) != {c['source_id'] for c in addendum['cohorts']}:
        raise RuntimeError('Reviewed17-source identity set differs from explicit adapters')
    artifacts, stages = {}, []
    def pin(path, expected=None):
        path = Path(path).resolve()
        if path.is_symlink() or not path.is_file() or not path.is_relative_to(root):
            raise RuntimeError('Continuation source input outside frozen run')
        actual = digest(path)
        if expected and actual != expected: raise RuntimeError('Reviewed continuation bytes differ: ' + str(path))
        key = str(path.relative_to(root));artifacts[key] = {'path': str(path), 'bytes': path.stat().st_size, 'sha256': actual}
        return key
    pin(addendum_path)
    for group in addendum['groups']:
        path = Path(group['ready_handoff']);pin(path, group['sha256']);ready = json.loads(path.read_text())
        for file, expected in ready['code_pins'].items():
            if digest(file) != expected: raise RuntimeError('Reviewed ready adapter/config changed: ' + file)
        pin(ready['qa_receipt'], ready['qa_sha256'])
    previous_plan = root / 'consolidation-plan/revision-3/plan.json'
    previous_state = root / 'consolidation-plan/revision-3/execution/status.json'
    previous_reconciliation = root / 'consolidation-plan/revision-3/execution/completed-subset-reconciliation.json'
    original_audit = root / 'finalisation/loaded-base-readiness-audit.bound.json'
    # Include every original source/artifact pin from the prior completed plan.
    prior = json.loads(previous_plan.read_text())
    for value in prior['artifacts'].values(): pin(value['path'], value['sha256'])
    old_state = json.loads(previous_state.read_text())
    for entry in old_state['cohorts'].values():
        if entry['status'] == 'completed': pin(entry['receipt_file'], entry['receipt_sha256'])
    lineage = {'kind': 'prior_full_audit_plus_completed_ingestion_receipts', 'original_audit_provider_keys': 395352,
        'completed_ready_stages': 14, 'new_full_integrity_audit': False}
    for key, path in [('original_audit', original_audit), ('completed_plan', previous_plan),
                       ('completed_state', previous_state), ('completed_reconciliation', previous_reconciliation)]:
        pin(path);lineage[key] = {'path': str(path), 'sha256': digest(path)}
    for c in addendum['cohorts']:
        key, spec = sources[c['source_id']];folder = Path(c['folder']).resolve()
        primary = folder / 'manifest.json'
        if key.startswith('western_'): primary = folder / spec['primary_manifest']
        pin(primary, c['primary_manifest_sha256'])
        if key == 'york_selected_facts':
            references = [pin(p) for p in input_files(folder)]
            pin(c['qa_receipt'], c['qa_receipt_sha256'])
        else:
            expected_files = spec.get('snapshot_files') or spec['files']
            references = [pin(folder / name, expected) for name, expected in expected_files.items()]
        module, function, kwargs = ADAPTERS[key]
        if (c['apply_module'], c['apply_function'], c['kwargs']) != (module, function, kwargs):
            raise RuntimeError('Ready handoff callable differs from explicit reviewed registry')
        module_path = Path(__file__).resolve().parents[2] / (module.replace('.', '/') + '.py')
        candidates = c.get('candidate_rows', c.get('canonical_company_candidates', 0))
        stages.append({'cohort_id': c['source_id'], 'source_id': c['source_id'], 'status': 'ready_for_assigned_writer',
            'source_folder': str(folder), 'primary_manifest': str(primary), 'primary_manifest_sha256': digest(primary),
            'record_unit': c.get('source_unit') or c.get('record_unit') or 'Historical2024publisher directory listing candidate',
            'input_observations': c['source_rows'], 'candidate_rows': candidates,
            'raw_only_or_history_rows': c['source_rows'] - candidates, 'unique_company_count': None,
            'market_completeness_verified': False, 'artifact_keys': references,
            'adapter_call': {'registry_key': key, 'module': module, 'function': function, 'kwargs': kwargs,
                             'source_module_path': str(module_path), 'source_module_sha256': digest(module_path)}})
    dependencies = [Path(__file__), Path(__file__).parent / 'consolidation.py', local_config, western_config, context_config]
    dependencies += [Path(__file__).parent / (name + '.py') for name in ['store', 'place_import', 'transport', 'factual_promotion', 'local_fact_promotion', 'western_fact_promotion', 'context_event_promotion']]
    plan = {'schema_version': 1, 'version': VERSION, 'created_at': stamp(), 'run_root': str(root),
        'status': 'reviewed17_stage_continuation_plan', 'active_partial_restricted_cohorts_included': False,
        'main_database_opened_or_mutated': False, 'intake_frozen': False,
        'baseline_provider_source_id': 'overture-2026-10-21.0', 'baseline_provider_keys': 487728,
        'provider_keys_after_net_new_promotion': 487728, 'baseline_organisation_count': 797609,
        'baseline_source_identity_counts': {s: 0 for s in sorted(sources)}, 'audit_lineage': lineage,
        'minimum_free_bytes_per_stage_and_import_batch': 2 * 1024**3,
        'code_dependencies': [{'path': str(p.resolve()), 'sha256': digest(p)} for p in dependencies],
        'stages': stages, 'artifacts': artifacts, 'readiness_counts': {'ready_adapters': 17, 'completed_snapshots_adapter_pending': 0},
        'source_rows': 176082, 'organisation_candidate_rows': 37620, 'raw_only_observations': 138462,
        'completion_policy': 'Only these17reviewed cohorts. Raw collection/frontier remains open; no market/unique-company completeness claim.',
        'later_queue': [{'cohort': 'municipal-gap-collection', 'normalized_observations': 679, 'unique_gers': 648,
                         'net_new_beyond_current_provider': 562, 'prospective_provider_count': 488290,
                         'included_in_current_plan': False, 'status': 'root_preparing_later_reviewed_provider_promotion'},
                        {'cohort': 'new_dairy_eastern_additional_GTA_and_other_raw_intake', 'included_in_current_plan': False, 'status': 'later_review_required'}]}
    validate_lineage(plan)
    plan['plan_id'] = hashlib.sha256(json.dumps({k: v for k, v in plan.items() if k != 'created_at'}, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
    output.mkdir(parents=True, exist_ok=True);atomic(output / 'plan.json', plan)
    report = preflight(output / 'plan.json');atomic(output / 'preflight.json', report)
    return plan, report


def main():
    parser = argparse.ArgumentParser();parser.add_argument('--run-root', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path);args = parser.parse_args()
    plan, report = build_continuation_plan(args.run_root, args.output)
    print(json.dumps({'plan_id': plan['plan_id'], **report}), flush=True)


if __name__ == '__main__': main()
