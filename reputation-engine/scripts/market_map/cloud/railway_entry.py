"""Persistent-volume research worker with a password-protected read-only dashboard."""
import base64
import hashlib
import hmac
import html
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import shutil
import signal
import sqlite3
import subprocess
import sys
import tarfile
import threading
import time

from scripts.market_map.site_research_campaign import campaign
from scripts.market_map.site_research_runner import export_results
from scripts.market_map.city_research_coordinator import coordinate

ROOT=Path(os.environ.get('RESEARCH_ROOT','/data/research'))
OUTPUT=ROOT/'artifacts/windsor-railway-20261031/campaign'
DB=ROOT/'artifacts/windsor-source-first-20261030/sites.sqlite3'
STATE={'state':'starting'}
STOP=threading.Event()
CITY_OUTPUT=ROOT/'artifacts/city-handoff-20261031/coordinator'


def restore_seed(archive, destination):
    """One-time validated transfer. Existing data is never replaced."""
    destination=Path(destination)
    if destination.exists():raise ValueError('Existing research directory must not be overwritten')
    stage=destination.with_name(destination.name+'.importing')
    stage.mkdir(mode=0o700)
    with tarfile.open(archive,'r:gz') as source:
        members=source.getmembers()
        if sum(m.size for m in members)>4*1024**3:raise ValueError('Seed exceeds extraction limit')
        if any(not m.isfile() or Path(m.name).is_absolute() or '..' in Path(m.name).parts for m in members):
            raise ValueError('Unsafe seed archive entry')
        if len({m.name for m in members})!=len(members):raise ValueError('Duplicate archive entries')
        manifest=json.load(source.extractfile('transfer-manifest.json'))
        if set(m.name for m in members)!=set(manifest['files'])|{'transfer-manifest.json'}:
            raise ValueError('Seed differs from manifest')
        for name,expected in manifest['files'].items():
            path=stage/name;path.parent.mkdir(parents=True,exist_ok=True)
            digest=hashlib.sha256()
            with source.extractfile(name) as incoming,path.open('xb') as out:
                while True:
                    chunk=incoming.read(1024*1024)
                    if not chunk:break
                    out.write(chunk);digest.update(chunk)
            path.chmod(0o600)
            if digest.hexdigest()!=expected:raise ValueError('Seed hash mismatch: '+name)
        db=stage/'artifacts/windsor-source-first-20261030/sites.sqlite3'
        conn=sqlite3.connect(str(db))
        try:
            if conn.execute('PRAGMA quick_check').fetchone()[0]!='ok':raise ValueError('Queue integrity failed')
            manifest['saved_investigations']=conn.execute('SELECT count(*) FROM research_results').fetchone()[0]
        finally:conn.close()
        (stage/'transfer-receipt.json').write_text(json.dumps(manifest,indent=2))
    stage.rename(destination)
    return manifest


def authenticated(header, password):
    if not password or not header or not header.startswith('Basic '):return False
    try:value=base64.b64decode(header[6:],validate=True).decode()
    except Exception:return False
    return hmac.compare_digest(value,'john:'+password)


class Handler(BaseHTTPRequestHandler):
    def log_message(self,*args):pass
    def do_GET(self):
        if self.path=='/health':
            self.send_response(200);self.end_headers();self.wfile.write(b'{"ok":true}');return
        if not authenticated(self.headers.get('Authorization'),os.environ.get('DASHBOARD_PASSWORD','')):
            self.send_response(401);self.send_header('WWW-Authenticate','Basic realm="Saturn research"');self.end_headers();return
        if self.path=='/status':
            status=dict(STATE)
            regional=ROOT/'artifacts/windsor-region-map-20261104/job-status.json'
            if regional.exists():status['regional_mapping']=json.loads(regional.read_text())
            enrichment=ROOT/'artifacts/regional-contact-enrichment-20261104'
            for name,key in [('status.json','contact_enrichment'),('carrier-status.json','contact_verification'),('daily-supervisor-status.json','daily_contact_workflow')]:
                if (enrichment/name).exists():status[key]=json.loads((enrichment/name).read_text())
            if (CITY_OUTPUT/'city-progress.json').exists():
                status['city_progress']=json.loads((CITY_OUTPUT/'city-progress.json').read_text())
            if (OUTPUT/'campaign.json').exists():
                c=json.loads((OUTPUT/'campaign.json').read_text())
                status['campaign']={k:v for k,v in c.items() if k!='attempted_ids'}
                for b in status['campaign'].get('batches',[]):b.pop('site_ids',None)
                batches=c.get('batches',[])
                if batches:
                    work=OUTPUT/f"batch-{batches[-1]['number']:03d}"
                    if (work/'api-usage.json').exists():
                        usage=json.loads((work/'api-usage.json').read_text())
                        status['live_batch']={'number':batches[-1]['number'],
                            'requests_started':usage.get('requests_started',0),
                            'responses_received':len(usage.get('responses',[])),
                            'http_errors':len(usage.get('errors',[])),
                            'transport_errors':len(usage.get('transport_errors',[]))}
            if DB.exists():
                conn=sqlite3.connect(DB.as_uri()+'?mode=ro',uri=True)
                try:
                    status['queue']={'site_tasks':conn.execute('SELECT count(*) FROM sites').fetchone()[0],
                        'saved_investigations':conn.execute('SELECT count(*) FROM research_results').fetchone()[0]}
                finally:conn.close()
            payload=json.dumps(status,indent=2).encode();mime='application/json'
        elif self.path=='/research/status':
            from scripts.research_hub.cloud import status
            payload=json.dumps(status(ROOT),indent=2).encode();mime='application/json'
        elif self.path in ('/research/listings/status','/research/listings/candidates',
                           '/research/listings/portfolios','/research/listings/events'):
            name={'/research/listings/status':'status.json', '/research/listings/candidates':'relationship-candidates.json',
                  '/research/listings/portfolios':'portfolios.json', '/research/listings/events':'portfolio-events.json'}[self.path]
            target=ROOT/'artifacts/research-hub/listings'/name
            if not target.exists():
                self.send_response(503);self.end_headers();self.wfile.write(b'Listing research has no saved report yet.');return
            payload=target.read_bytes();mime='application/json'
        elif self.path in ('/research/contact-routes/status','/research/contact-routes/candidates','/research/contact-routes/audit','/research/contact-routes/batch'):
            name={'/research/contact-routes/status':'status.json','/research/contact-routes/candidates':'candidates.json',
                  '/research/contact-routes/audit':'directory-route-audit.json','/research/contact-routes/batch':'batch.json'}[self.path]
            target=ROOT/'artifacts/research-hub/contact-routes'/name
            if not target.exists():
                self.send_response(503);self.end_headers();self.wfile.write(b'Contact-route research has no saved report yet.');return
            payload=target.read_bytes();mime='application/json'
        elif self.path in ('/investors/status','/investors/people.csv','/investors/emails.csv','/investors/tasks.csv'):
            name={'/investors/status':'status.json','/investors/people.csv':'people-leads.csv',
                  '/investors/emails.csv':'email-routes.csv','/investors/tasks.csv':'tasks.csv'}[self.path]
            target=ROOT/'artifacts/investor-research-20261110/cloud'/name
            if not target.exists():
                self.send_response(503);self.end_headers();self.wfile.write(b'Investor research is starting.');return
            payload=target.read_bytes();mime='application/json' if name.endswith('.json') else 'text/csv; charset=utf-8'
        elif self.path=='/contacts/status':
            folder=ROOT/'artifacts/regional-contact-enrichment-20261104'
            report={name:json.loads((folder/name).read_text()) for name in ['status.json','carrier-status.json','daily-supervisor-status.json','daily-contact-scorecard.json','outcome-monitor-status.json','source-identity-worker-status.json','mobile-crm-worker-status.json'] if (folder/name).exists()}
            payload=json.dumps(report,indent=2).encode();mime='application/json'
        elif self.path in ('/region','/region/status','/region/places.csv'):
            name={'/region':'index.html','/region/status':'job-status.json','/region/places.csv':'places.csv'}[self.path]
            target=ROOT/'artifacts/windsor-region-map-20261104'/name
            if not target.exists():
                self.send_response(503);self.end_headers();self.wfile.write(b'Regional map is being prepared. See /status.');return
            payload=target.read_bytes()
            mime={'index.html':'text/html; charset=utf-8','job-status.json':'application/json','places.csv':'text/csv; charset=utf-8'}[name]
        elif self.path=='/':
            payload=(OUTPUT/'index.html').read_bytes() if (OUTPUT/'index.html').exists() else b'<h1>Saturn research</h1><a href="/status">Worker status</a>'
            payload=b'<nav><a href="/research/status">All research lanes</a> | <a href="/research/listings/candidates">Listing relationships</a> | <a href="/region">Regional map</a> | <a href="/contacts/status">Contact pipeline</a> | <a href="/cities">City progress</a> | <a href="/status">Live worker status</a></nav>'+payload
            mime='text/html; charset=utf-8'
        elif self.path=='/cities':
            progress=json.loads((CITY_OUTPUT/'city-progress.json').read_text()) if (CITY_OUTPUT/'city-progress.json').exists() else {'cities':[]}
            rows=''.join('<tr>'+''.join('<td>'+html.escape(str(c.get(k,'')))+'</td>' for k in
                ('municipality','state','site_tasks','saved_investigations','foundation_held_buildings'))+'</tr>' for c in progress['cities'])
            payload=('<!doctype html><meta charset="utf-8"><title>City research progress</title><style>body{font:16px system-ui;margin:2rem}td,th{padding:.5rem;text-align:left;border-bottom:1px solid #ccc}</style>'
                '<h1>City research progress</h1><p>Windsor first. Queued cities advance only after the current eligible pass ends. '
                'Foundation gaps and unresolved occupants are retained; no city is certified complete.</p><a href="/">Current city investigations</a>'
                '<table><tr><th>Municipality</th><th>Status</th><th>Site tasks</th><th>Saved investigations</th><th>Buildings needing address resolution</th></tr>'+rows+'</table>').encode()
            mime='text/html; charset=utf-8'
        else:self.send_response(404);self.end_headers();return
        self.send_response(200);self.send_header('Content-Type',mime)
        self.send_header('Cache-Control','no-store');self.end_headers();self.wfile.write(payload)


def main():
    global OUTPUT,DB
    os.umask(0o077)
    def stopping(*_):
        STOP.set()
        if STATE.get('state')=='researching' and OUTPUT.exists():
            (OUTPUT/'STOP').write_text('Cloud service termination requested.\n')
    signal.signal(signal.SIGTERM,stopping);signal.signal(signal.SIGINT,stopping)
    server=ThreadingHTTPServer(('0.0.0.0',int(os.environ.get('PORT','8080'))),Handler)
    threading.Thread(target=server.serve_forever,daemon=True).start()
    seed=Path('/data/seed.tar.gz')
    try:
        while not ROOT.exists() and not STOP.is_set():
            if seed.exists() and Path('/data/seed.ready').exists():
                STATE['state']='verifying_seed'
                receipt=restore_seed(seed,ROOT)
                STATE['imported_investigations']=receipt['saved_investigations']
            else:STATE['state']='waiting_for_seed';STOP.wait(5)
        if STOP.is_set():return
        shutil.copytree('/app/scripts',ROOT/'scripts',dirs_exist_ok=True)
        shutil.copytree('/app/docs',ROOT/'docs',dirs_exist_ok=True)
        if Path('/app/handoff').exists():
            dest=ROOT/'artifacts/city-handoff-20261031';dest.mkdir(exist_ok=True)
            for incoming in Path('/app/handoff').glob('*.json'):
                target=dest/incoming.name
                if target.exists() and target.read_bytes()!=incoming.read_bytes():
                    raise ValueError('Changed city handoff requires explicit reconciliation')
                if not target.exists():shutil.copyfile(incoming,target)
        os.chdir(ROOT);OUTPUT.mkdir(parents=True,exist_ok=True)
        export_results(DB,OUTPUT)
        STATE['state']='ready_idle'
        if (ROOT/'.private/listing-research.json').exists():
            from scripts.research_hub.cloud import run as listing_workflow
            threading.Thread(target=listing_workflow,args=(ROOT,STOP),daemon=True).start()
        if os.environ.get('INVESTOR_RESEARCH_ENABLED')=='1':
            def investor_workflow():
                folder=ROOT/'artifacts/investor-research-20261110/cloud';folder.mkdir(parents=True,exist_ok=True)
                # Queue, source receipts, and usage survive deployment. Never replace the DB.
                seed=Path('/app/investor-input/seeds.json')
                if seed.exists():shutil.copyfile(seed,folder/'seeds.json')
                hints=Path('/app/investor-input/company-hints.json')
                if hints.exists():shutil.copyfile(hints,folder/'company-hints.json')
                with (folder/'worker.log').open('ab') as log:
                    subprocess.run([sys.executable,'-u',str(ROOT/'scripts/investor_research/worker.py'),
                        '--root',str(folder),'--seed',str(folder/'seeds.json'),
                        '--max-calls',os.environ.get('INVESTOR_MAX_CALLS','400'),
                        '--max-estimated-usd',os.environ.get('INVESTOR_ESTIMATED_USD_LIMIT','25'),
                        '--workers','3'],stdout=log,stderr=log)
            threading.Thread(target=investor_workflow,daemon=True).start()
        if os.environ.get('REGIONAL_OUTCOMES_ENABLED')=='1':
            def outcome_workflow():
                from scripts.market_map.cloud.regional_outcome_monitor import run
                run(STOP)
            threading.Thread(target=outcome_workflow,daemon=True).start()
        if os.environ.get('REGIONAL_CONTACTS_ENABLED')=='1':
            def identity_workflow():
                from scripts.market_map.cloud.regional_identity_review import run
                run(STOP)
            threading.Thread(target=identity_workflow,daemon=True).start()
            def mobile_crm_workflow():
                from scripts.market_map.cloud.regional_mobile_crm_worker import run
                run(STOP)
            threading.Thread(target=mobile_crm_workflow,daemon=True).start()
            def contact_workflow():
                from scripts.market_map.cloud.regional_daily_supervisor import run
                try:run(STOP)
                except Exception as exc:print(json.dumps({'contact_workflow_error':str(exc)[:500]}),flush=True)
            threading.Thread(target=contact_workflow,daemon=True).start()
        if os.environ.get('REGIONAL_MAPPING_ENABLED')=='1':
            def mapping_job():
                from scripts.market_map.cloud.regional_mapping import run
                try:run('/app/regional-input',ROOT/'artifacts/windsor-region-map-20261104')
                except Exception as exc:print(json.dumps({'regional_mapping_error':str(exc)[:500]}),flush=True)
            threading.Thread(target=mapping_job,daemon=True).start()
        if os.environ.get('RESEARCH_ENABLED')=='1':
            if not os.environ.get('OPENAI_API_KEY'):raise ValueError('API credential missing')
            STATE['state']='researching'
            manifest=ROOT/'artifacts/city-handoff-20261031/city-manifest.json'
            if manifest.exists():
                def selected(city):
                    global OUTPUT,DB
                    OUTPUT=ROOT/city['output'];DB=ROOT/city['db']
                    STATE['active_city']=city['name']
                result=coordinate(ROOT,manifest,CITY_OUTPUT,
                    max_sites=int(os.environ.get('MAX_SITES','4000')),
                    max_api_calls=int(os.environ.get('MAX_API_CALLS','11280')),on_city=selected)
                STATE['state']=result['state']
            else:
                result=campaign(DB,ROOT,OUTPUT,max_sites=int(os.environ.get('MAX_SITES','4000')),
                    max_api_calls=int(os.environ.get('MAX_API_CALLS','11280')))
                STATE['state']=result['status']
        while not STOP.wait(10):pass
    except Exception as exc:
        STATE.update(state='needs_attention',error_type=type(exc).__name__,error=str(exc)[:500])
        print(json.dumps(STATE),flush=True)
        while not STOP.wait(10):pass
    finally:server.shutdown()


if __name__=='__main__':main()
