"""Isolate public website visits so a slow server cannot stall the coordinator."""
import json
import multiprocessing
import tempfile
from pathlib import Path


def _worker(path, job, frontier, names, page_limit):
    from .email_acquisition import collect_domain

    def checkpoint(result):
        temporary = Path(path + '.tmp')
        temporary.write_text(json.dumps(result))
        temporary.replace(path)

    result = collect_domain(job, frontier, names, page_limit=page_limit, checkpoint=checkpoint)
    result['worker_complete'] = True
    checkpoint(result)


def collect_bounded(job, frontier, names, *, page_limit=4, deadline_seconds=60, worker_target=None):
    if deadline_seconds <= 0:
        raise ValueError('Positive domain deadline required')
    with tempfile.TemporaryDirectory(prefix='ssm-email-visit-') as directory:
        path = str(Path(directory) / 'checkpoint.json')
        process = multiprocessing.get_context('spawn').Process(
            target=worker_target or _worker, args=(path, job, frontier, names, page_limit))
        process.start()
        try:
            process.join(deadline_seconds)
            timed_out = process.is_alive()
            if timed_out:
                process.terminate()
                process.join(2)
                if process.is_alive():
                    process.kill()
                    process.join(2)
            result = json.loads(Path(path).read_text()) if Path(path).exists() else {
                'domain': job['domain'], 'pages': [], 'emails': [], 'discovered': [],
                'frontier_updates': [], 'full_site_exhausted': False,
                'main_database_writes': 0, 'messages_sent': 0}
            if timed_out or process.exitcode != 0 or not result.get('worker_complete'):
                if timed_out and result.get('active_url'):
                    import uuid
                    result.setdefault('visit_id',uuid.uuid4().hex)
                    result.setdefault('frontier_failures',[]).append({'url':result['active_url'],'code':'timeout','retryable':True,'http_status':None,'retry_after_at':None,'budget_reason':None,'policy_scope':'url','message':'Worker deadline interrupted active page processing; completion unknown'})
                    result.setdefault('frontier_updates',[]).append((result['active_url'],'typed_failure','worker deadline'))
                result['job_status'] = 'domain_timeout_review' if timed_out else 'domain_worker_error_review'
                result['transport_checkpoint'] = result.get('transport')
                result['transport'] = {'requests': None, 'bytes_fetched': None}
                result['deadline_seconds'] = deadline_seconds
                result['worker_exitcode'] = process.exitcode
            return result
        finally:
            if process.is_alive():
                process.kill()
                process.join(2)
            process.close()
