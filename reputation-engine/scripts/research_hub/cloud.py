"""Cloud launcher and shared read-only status for existing research lanes."""
import json
from pathlib import Path
import subprocess
import sys


def status(root):
    root = Path(root)
    files = {
        'listing_relationships': 'artifacts/research-hub/listings/status.json',
        'realtor_contact_routes': 'artifacts/research-hub/contact-routes/status.json',
        'investors': 'artifacts/investor-research-20261110/cloud/status.json',
        'local_business_contacts': 'artifacts/regional-contact-enrichment-20261104/daily-supervisor-status.json',
        'city_mapping': 'artifacts/windsor-region-map-20261104/job-status.json',
    }
    result = {'schema_version': 'research-hub/1.0', 'lanes': {},
              'note': 'Each worker retains its evidence and queue. Read timestamps; a saved status is not a live heartbeat.'}
    for lane, name in files.items():
        path = root / name
        try:
            data = json.loads(path.read_text())
            result['lanes'][lane] = {'report_file_modified_epoch': path.stat().st_mtime, 'report': data}
        except (OSError, ValueError):
            result['lanes'][lane] = {'state': 'report_unavailable'}
    return result


def run(root, stop):
    root = Path(root)
    folder = root / 'artifacts/research-hub/listings'
    folder.mkdir(parents=True, exist_ok=True)
    config = root / '.private/listing-research.json'
    while not stop.is_set():
        if config.exists() and not (folder / 'STOP').exists():
            settings = json.loads(config.read_text())
            cmd = [sys.executable, '-u', '-m', 'scripts.research_hub.listings',
                   '--root', str(folder), '--credentials', str(config),
                   '--manifest', str(root / 'artifacts/research-hub/region-manifest.json'),
                   '--crm-credentials', str(root / '.private/regional-outcomes.json'),
                   '--max-calls', str(settings.get('max_calls', 5))]
            if settings.get('research_enabled', False):
                cmd.append('--research')
            with (folder / 'worker.log').open('ab') as log:
                child = subprocess.Popen(cmd, cwd=root, stdout=log, stderr=log)
                while child.poll() is None:
                    if stop.wait(1):
                        child.terminate()
                        try:
                            child.wait(timeout=10)
                        except subprocess.TimeoutExpired:
                            child.kill(); child.wait()
                        return
            if settings.get('contact_research_enabled', False):
                contact_folder = root / 'artifacts/research-hub/contact-routes'
                contact_folder.mkdir(parents=True, exist_ok=True)
                if settings.get('team_batch_refresh_enabled', False):
                    from scripts.research_hub.listings import atomic, now
                    try:
                        from scripts.research_hub.team_batch import refresh_captured_batch
                        refresh_captured_batch(contact_folder)
                        atomic(contact_folder / 'batch-supervisor.json', {'checked_at': now(), 'state': 'completed'})
                    except Exception as exc:
                        atomic(contact_folder / 'batch-supervisor.json', {'checked_at': now(),
                               'state': 'refresh_failed_prior_evidence_retained', 'error': type(exc).__name__})
                contact_cmd = [sys.executable, '-u', '-m', 'scripts.research_hub.contact_routes',
                               '--root', str(contact_folder), '--research', '--max-calls',
                               str(settings.get('contact_max_calls', 2))]
                contact_cmd += ['--listing-candidates', str(folder / 'relationship-candidates.json')]
                if not (contact_folder / 'directory-route-audit.json').exists():
                    contact_cmd += ['--seed', '--preferred', *settings.get('contact_pilot_identities', [])]
                with (contact_folder / 'worker.log').open('ab') as log:
                    child = subprocess.Popen(contact_cmd, cwd=root, stdout=log, stderr=log)
                    while child.poll() is None:
                        if stop.wait(1):
                            child.terminate()
                            try:child.wait(timeout=10)
                            except subprocess.TimeoutExpired:child.kill();child.wait()
                            return
        if stop.wait(300):
            break
