"""Bounded source-first collection. No paid calls or legacy building admissions.

Input URL manifest is coordinator-curated: {site_id: [https_source_url, ...]}.
Missing sources go to discovery review; they never become empty-building findings.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
import shutil
import time

from .site_research_queue import SiteResearchQueue
from .site_source_extract import extract_source
from .source_capture_cache import atomic
from .trusted_source_capture import capture_sources


def collect_site(site, urls, root, output, collector=capture_sources):
    root, output = Path(root).resolve(), Path(output).resolve()
    if root not in output.parents:
        raise ValueError('Output must remain inside project')
    urls = list(dict.fromkeys(urls))
    if not urls or len(urls) > 12:
        raise ValueError('Each site requires 1..12 selected source URLs')
    output.mkdir(parents=True, exist_ok=True)
    results, errors, receipts = [], [], []
    for url in urls:
        try:
            captured = collector([{'source_url': url}], output, root,
                                 validate_worker_excerpts=False)
            if url not in captured:
                failures=getattr(collector,'failures',[])
                reason=next((f['reason'] for f in failures if f.get('url')==url),'Source not captured')
                raise ValueError(reason)
            receipt = captured[url]
            body_path = (root / receipt['body_path']).resolve()
            if root not in body_path.parents:
                raise ValueError('Capture path outside repository')
            result = extract_source(body_path.read_bytes(), source_url=url,
                retrieved_at=receipt['retrieved_at'],
                target_addresses=json.loads(site['addresses']),
                target_locality=site['municipality'],
                content_type=receipt.get('content_type') or 'text/plain',
                expected_sha256=receipt['body_sha256'])
            # Keep evidence references, not repeated copies of entire page text.
            result.pop('text', None)
            if receipt.get('rendering_gap') or receipt.get('rendering_status') == 'captured_with_rendering_gaps':
                result['gaps'].append(receipt.get('rendering_gap') or 'rendering_incomplete')
                result['route']='ai_research'
            results.append(result)
            receipts.append(dict(url=url, retrieved_at=receipt['retrieved_at'],
                sha256=receipt['body_sha256'], body_path=receipt['body_path'],
                extraction_route=result['route'],content_type=receipt.get('content_type') or 'text/plain'))
        except Exception as exc:
            errors.append({'url': url, 'reason': str(exc)[:1000]})
    report = dict(site_id=site['site_id'], sources=results, capture_failures=errors,
        requires_ai=bool(errors) or not results or any(r['route']=='ai_research' for r in results),
        occupancy_verified=False, tenant_coverage_complete=False, model_calls=0)
    atomic(output/'result.json', json.dumps(report, indent=2).encode())
    return report, receipts


def run(db, manifest, municipality, district, root, output, limit=5, concurrency=3):
    if not 1 <= limit <= 50 or not 1 <= concurrency <= 10:
        raise ValueError('Limits: 1..50 sites, 1..10 collectors')
    if shutil.disk_usage(root).free < 2*1024**3:
        raise ValueError('At least 2 GiB free disk required')
    output = Path(output)
    output.mkdir(parents=True, exist_ok=True)
    started = time.monotonic()
    def task(index):
        queue = SiteResearchQueue(db)
        try:
            site = queue.claim(municipality, district, 'source-first-'+str(index), lease_seconds=3600)
            if site is None:
                return {'state':'no_pending_site'}
            urls = manifest.get(site['site_id'], [])
            if not urls:
                queue.fail(site['site_id'], site['token'], 'source_discovery_required', retry_delay=86400)
                return {'site_id':site['site_id'], 'state':'source_discovery_required'}
            report, receipts = collect_site(site, urls, root, output/site['site_id'].replace(':','-'))
            if receipts:
                queue.finish(site['site_id'], site['token'], receipts, needs_review=report['requires_ai'])
            else:
                queue.fail(site['site_id'], site['token'], 'all_selected_sources_failed')
            return {'site_id':site['site_id'], 'state':'review_required' if report['requires_ai'] else 'evidence_collected',
                    'captured_sources':len(receipts), 'capture_failures':len(report['capture_failures'])}
        finally:
            queue.close()
    with ThreadPoolExecutor(max_workers=concurrency) as pool:
        results = list(pool.map(task, range(limit)))
    report = dict(elapsed_seconds=time.monotonic()-started, results=results, model_calls=0,
                  verified_occupants_asserted=0, legacy_queue_mutations=0)
    atomic(output/'batch.json', json.dumps(report, indent=2).encode())
    return report


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ('db','manifest','root','output'):
        parser.add_argument('--'+name, type=Path, required=True)
    parser.add_argument('--municipality', required=True)
    parser.add_argument('--district', required=True)
    parser.add_argument('--limit', type=int, default=5)
    parser.add_argument('--concurrency', type=int, default=3)
    args=vars(parser.parse_args())
    args['manifest']=json.loads(args['manifest'].read_text())
    print(json.dumps(run(**args), indent=2))


if __name__=='__main__':
    main()
