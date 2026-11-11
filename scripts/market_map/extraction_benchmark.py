"""Deterministic saved-byte replay. No downloader, owner guessing or outreach."""
import argparse
import hashlib
import json
from pathlib import Path
import platform
import tempfile


def digest(data):
    return hashlib.sha256(data).hexdigest()


def stable(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False, indent=2) + '\n'


def load_manifest(path, labels_path):
    path = Path(path).resolve()
    manifest = json.loads(path.read_text())
    if manifest.get('schema_version') != 1 or manifest.get('label_scope') != 'page_unique_channel':
        raise ValueError('unsupported corpus schema/scope')
    ids = set()
    for page in manifest['pages']:
        if page['id'] in ids:
            raise ValueError('duplicate capture id')
        ids.add(page['id'])
        if page.get('approval') != 'synthetic_authorized_by_implementation_request' or page.get('retention') != 'synthetic_no_personal_data':
            raise ValueError('unapproved corpus: real captures require a reviewed import contract')
        filename = (path.parent / page['file']).resolve()
        if not filename.is_relative_to(path.parent) or digest(filename.read_bytes()) != page['sha256']:
            raise ValueError('capture path or hash mismatch')
    labels = [json.loads(line) for line in Path(labels_path).read_text().splitlines() if line.strip()]
    if len(labels) != len(ids) or {row['id'] for row in labels} != ids:
        raise ValueError('missing/duplicate labels')
    for row in labels:
        if row.get('exhaustive') is not True:
            raise ValueError('exhaustive page labels required for precision')
        for name in ('emails', 'phones', 'attribution'):
            values = row[name]
            if len({stable(v) for v in values}) != len(values):
                raise ValueError('duplicate label')
        phone_keys = [(p['phone'], p['extension'], p['kind']) for p in row['phones']]
        if len(phone_keys) != len(set(phone_keys)):
            raise ValueError('conflicting phone annotations')
        for edge in row['attribution']:
            if not edge.get('owner') or edge['channel'] not in row['emails']:
                raise ValueError('missing owner or channel')
    return manifest, {r['id']: r for r in labels}


def replay_pages(manifest, base):
    from .email_extraction import extract_published_emails
    from .phone_extraction import extract_published_phones
    from .contact_context import extract_contact_context
    results = {}
    for page in manifest['pages']:
        body = (Path(base) / page['file']).read_bytes()
        if digest(body) != page['sha256']:
            raise ValueError('capture changed after validation')
        context = extract_contact_context(body, page['url'])
        diagnostics = []
        emails = extract_published_emails(body, page['url'], candidate_evidence=diagnostics)
        results[page['id']] = {
            'emails': emails, 'email_candidates': diagnostics,
            'phones': extract_published_phones(body, page['url']), 'context': context,
            # Evaluate only actual person/email assertions, never infer company from host.
            'attribution': sorted([{'channel': email, 'owner': p['name'], 'relation': 'person_card'}
                                   for p in context['people'] for email in p['emails']], key=stable)}
    return results


def counts(predicted, expected):
    tp, fp, fn = len(predicted & expected), len(predicted - expected), len(expected - predicted)
    precision = tp / (tp + fp) if tp + fp else None
    recall = tp / (tp + fn) if tp + fn else None
    return {'tp': tp, 'fp': fp, 'fn': fn, 'precision': precision, 'recall': recall,
            'f1': 2 * tp / (2 * tp + fp + fn) if 2 * tp + fp + fn else None}


def score_extraction(results, labels):
    output = {}
    for channel in ('email', 'phone', 'phone_kind'):
        predicted, expected = set(), set()
        for key, label in labels.items():
            if channel == 'email':
                predicted.update((key, r['email']) for r in results[key]['emails'])
                expected.update((key, value) for value in label['emails'])
            else:
                def identity(r):
                    return (key, r['phone'], r['extension']) + ((r['kind'],) if channel == 'phone_kind' else ())
                predicted.update(identity(r) for r in results[key]['phones'])
                expected.update(identity(r) for r in label['phones'])
        output[channel] = counts(predicted, expected)
    output['fax_as_phone'] = sum(len({(r['phone'], r['extension']) for r in results[key]['phones'] if r['kind'] == 'phone'} &
                                   {(r['phone'], r['extension']) for r in label['phones'] if r['kind'] == 'fax'} -
                                   {(r['phone'], r['extension']) for r in label['phones'] if r['kind'] == 'phone'})
                               for key, label in labels.items())
    return output


def score_attribution(results, labels):
    predicted, expected = set(), set()
    unknown = 0
    for key, label in labels.items():
        if label['attribution_known']:
            predicted.update((key, stable(e)) for e in results[key]['attribution'])
            expected.update((key, stable(e)) for e in label['attribution'])
        else:
            unknown += len(results[key]['attribution'])
    return {**counts(predicted, expected), 'unscored_unknown_owner_predictions': unknown,
            'scope': 'published person-card association; not verified employment/company ownership'}


ERROR_CATEGORIES = ('Acquisition or crawl failure', 'HTML/DOM extraction failure',
                    'Structured-data extraction failure', 'Normalization error',
                    'Incorrect channel type', 'Duplicate/entity resolution error',
                    'Incorrect attribution', 'Unsupported format', 'Unknown or insufficient evidence')


def analyze_errors(results, labels):
    """List every FP/FN; never infer a missing channel's cause from absence alone.

    Optional error_evidence annotations must identify the channel/value/outcome,
    category, evidence and observed/hypothesis basis. Hypotheses remain separate.
    """
    errors = []
    for page_id, gold in sorted(labels.items()):
        page = results[page_id]
        def emit(channel, outcome, value, expected, actual, category=None, evidence=None):
            hypotheses = []
            for annotation in gold.get('error_evidence', []):
                if (annotation.get('channel'), annotation.get('outcome'), annotation.get('value')) != (channel, outcome, value):
                    continue
                if annotation.get('category') not in ERROR_CATEGORIES or not annotation.get('evidence') or annotation.get('basis') not in ('observed', 'hypothesis'):
                    raise ValueError('invalid error evidence annotation')
                if annotation['basis'] == 'hypothesis':
                    hypotheses.append(annotation)
                elif category is None:
                    category, evidence = annotation['category'], annotation['evidence']
            if category is None and page.get('acquisition_status') == 'failed' and page.get('acquisition_error'):
                category, evidence = ERROR_CATEGORIES[0], page['acquisition_error']
            if category is None:
                for diagnostic in page.get('email_candidates', []):
                    if diagnostic.get('candidate_value') == value and diagnostic.get('status') in ('invalid', 'unsupported'):
                        category = 'Unsupported format' if diagnostic['status'] == 'unsupported' else 'Normalization error'
                        evidence = diagnostic
                        break
            errors.append({'page_id': page_id, 'channel': channel, 'outcome': outcome, 'value': value,
                           'category': category or ERROR_CATEGORIES[-1],
                           'basis': 'observed' if evidence is not None else 'insufficient_evidence',
                           'evidence': evidence, 'hypotheses': hypotheses, 'expected': expected, 'actual': actual,
                           'source_predictions': page})
        actual_email = {r['email'] for r in page['emails']}
        expected_email = set(gold['emails'])
        for value in sorted(actual_email - expected_email): emit('email', 'false_positive', value, None, value)
        for value in sorted(expected_email - actual_email): emit('email', 'false_negative', value, value, None)
        identity = lambda r: (r['phone'], r['extension'], r['kind'])
        actual_phone = {identity(r) for r in page['phones']}
        expected_phone = {identity(r) for r in gold['phones']}
        for outcome, difference, others in [('false_positive', actual_phone - expected_phone, expected_phone),
                                             ('false_negative', expected_phone - actual_phone, actual_phone)]:
            for value in sorted(difference):
                mismatch = [r for r in others if r[:2] == value[:2]]
                emit('phone', outcome, list(value), list(value) if outcome == 'false_negative' else mismatch,
                     list(value) if outcome == 'false_positive' else mismatch,
                     'Incorrect channel type' if mismatch else None,
                     {'same_base_extension_other_kind': mismatch} if mismatch else None)
        if gold['attribution_known']:
            actual = {stable(r): r for r in page['attribution']}
            expected = {stable(r): r for r in gold['attribution']}
            for outcome, difference in [('false_positive', actual.keys() - expected.keys()), ('false_negative', expected.keys() - actual.keys())]:
                for value in sorted(difference):
                    emit('attribution', outcome, json.loads(value), expected.get(value), actual.get(value),
                         'Incorrect attribution', 'Exact labeled edge mismatch; underlying cause not inferred')
    return errors


def compare_runs(before, after):
    """Full record diff includes raw values, removals, metadata and provenance."""
    changes = []
    for key in sorted(set(before) | set(after)):
        for channel in ('emails', 'phones', 'context', 'attribution', 'email_candidates'):
            old, new = before.get(key, {}).get(channel), after.get(key, {}).get(channel)
            if old != new:
                changes.append({'id': key, 'component': channel, 'before': old, 'after': new})
    return changes


def benchmark(manifest_path, labels_path):
    manifest, labels = load_manifest(manifest_path, labels_path)
    results = replay_pages(manifest, Path(manifest_path).parent)
    import lxml.etree
    source = Path(__file__).parent
    names = ['extraction_benchmark.py', 'offline_guard.py', 'email_extraction.py', 'phone_extraction.py', 'contact_context.py', 'relationships.py', 'contact_normalization.py']
    return {'schema_version': 1, 'corpus': 'synthetic development regression set; not production accuracy',
            'manifest_sha256': digest(Path(manifest_path).read_bytes()), 'labels_sha256': digest(Path(labels_path).read_bytes()),
            'python': platform.python_version(), 'lxml': lxml.etree.LXML_VERSION,
            'source_sha256': {name: digest((source / name).read_bytes()) for name in names if (source / name).exists()},
            'capture_count': len(results), 'extraction': score_extraction(results, labels),
            'attribution': score_attribution(results, labels), 'predictions': results,
            'errors': analyze_errors(results, labels), 'error_categories': ERROR_CATEGORIES}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--manifest', required=True)
    parser.add_argument('--labels', required=True)
    parser.add_argument('--baseline')
    parser.add_argument('--output', required=True, help='New directory under system temp only')
    parser.add_argument('--offline', required=True, action='store_true')
    args = parser.parse_args()
    output = Path(args.output).resolve()
    temp = Path(tempfile.gettempdir()).resolve()
    if output == temp or not output.is_relative_to(temp) or output.exists():
        parser.error('output must be a new child directory under ' + str(temp))
    from .offline_guard import OfflineGuard
    guard = OfflineGuard(output)
    guard.install()
    output.mkdir(parents=True)
    run = benchmark(args.manifest, args.labels)
    (output / 'run.json').write_text(stable(run))
    if args.baseline:
        baseline = json.loads(Path(args.baseline).read_text())
        if any(baseline[k] != run[k] for k in ('manifest_sha256', 'labels_sha256')):
            raise ValueError('baseline corpus/labels differ')
        (output / 'changes.json').write_text(stable(compare_runs(baseline['predictions'], run['predictions'])))
    if guard.violations:
        raise RuntimeError('unexpected blocked IO: ' + repr(guard.violations))
    print(stable({k: run[k] for k in ('capture_count', 'extraction', 'attribution')}))


if __name__ == '__main__':
    main()
