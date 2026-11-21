"""Independent derived graph queue seeded from the email queue READ ONLY.

Copies domain/organisation associations only, never the canonical inventory or
email evidence. Domain processes have a wall-time limit and saved frontiers.
"""
from __future__ import annotations
import argparse
from collections import Counter
from contextlib import closing
import hashlib
import json
import multiprocessing
from pathlib import Path
import sqlite3
import time
from .relationship_observations import (guard,save,stamp,identifier,WaveBudget,observe_domain,export_derived,eligible,StorageHold)
from .relationship_review import review
from .transport import Transport,SourceBlocked


def connect(path,readonly=False):
    connection=sqlite3.connect('file:'+str(Path(path).resolve())+'?mode=ro',uri=True,timeout=10) if readonly else sqlite3.connect(path,timeout=10)
    connection.row_factory=sqlite3.Row;return connection


def initialise(path):
    connection=connect(path)
    connection.executescript('''
      CREATE TABLE IF NOT EXISTS jobs(domain TEXT PRIMARY KEY,id TEXT UNIQUE NOT NULL,url TEXT NOT NULL,priority TEXT NOT NULL,
        queue_status TEXT NOT NULL DEFAULT 'pending',attempt_waves INTEGER NOT NULL DEFAULT 0,state_status TEXT);
      CREATE INDEX IF NOT EXISTS graph_job_order ON jobs(queue_status,attempt_waves,priority);
      CREATE TABLE IF NOT EXISTS associations(organisation_id TEXT,domain TEXT,url TEXT,name TEXT,raw_domain TEXT,
        PRIMARY KEY(organisation_id,domain,url)) WITHOUT ROWID;
      CREATE INDEX IF NOT EXISTS graph_association_domain ON associations(domain);
      CREATE TABLE IF NOT EXISTS frontier(domain TEXT,url TEXT,depth INTEGER,kind TEXT,status TEXT,error TEXT,discovered_on TEXT,
        PRIMARY KEY(domain,url)) WITHOUT ROWID;
      CREATE TABLE IF NOT EXISTS seed_meta(key TEXT PRIMARY KEY,value_json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS seed_batches(kind TEXT,last_key TEXT,rows INTEGER,content_sha256 TEXT,
        PRIMARY KEY(kind,last_key));
    ''');connection.commit();return connection


def seed(source,output,chunk=1000):
    output=Path(output);output.mkdir(parents=True,exist_ok=True);(output/'domains').mkdir(exist_ok=True);guard(output)
    target=initialise(output/'queue.sqlite');source=Path(source).resolve()
    def meta(key,default=None):
        row=target.execute('SELECT value_json FROM seed_meta WHERE key=?',(key,)).fetchone()
        return json.loads(row[0]) if row else default
    def setmeta(key,value):target.execute('INSERT OR REPLACE INTO seed_meta VALUES(?,?)',(key,json.dumps(value)))
    if meta('source_path') not in (None,str(source)):raise ValueError('Derived graph queue is pinned to a different source queue')
    setmeta('source_path',str(source));target.commit()
    with closing(connect(source,True)) as upstream:
        expected={'domains':upstream.execute('SELECT COUNT(*) FROM jobs').fetchone()[0],
                  'associations':upstream.execute('SELECT COUNT(*) FROM associations').fetchone()[0]}
    last=meta('last_domain','')
    while True:
        guard(output)
        with closing(connect(source,True)) as upstream:rows=upstream.execute('SELECT domain,url,priority FROM jobs WHERE domain>? ORDER BY domain LIMIT ?',(last,chunk)).fetchall()
        if not rows:break
        canonical=[dict(row) for row in rows]
        with target:
            target.executemany('INSERT OR IGNORE INTO jobs(domain,id,url,priority) VALUES(?,?,?,?)',
                [(row['domain'],hashlib.sha256(row['domain'].encode()).hexdigest(),row['url'],row['priority']) for row in rows])
            target.executemany('INSERT OR IGNORE INTO frontier(domain,url,depth,kind,status) VALUES(?,?,0,\'initial_site\',\'pending\')',[(row['domain'],row['url']) for row in rows])
            last=rows[-1]['domain'];setmeta('last_domain',last)
            target.execute('INSERT OR REPLACE INTO seed_batches VALUES(?,?,?,?)',('jobs',last,len(rows),identifier(canonical)))
        print(json.dumps({'stage':'relationship_domain_seed','last_domain':last,'batch_rows':len(rows)}),flush=True)
    last=meta('last_association',['','',''])
    while True:
        guard(output)
        with closing(connect(source,True)) as upstream:
            rows=upstream.execute('SELECT organisation_id,domain,url,name,raw_domain FROM associations WHERE (organisation_id,domain,url)>(?,?,?) ORDER BY organisation_id,domain,url LIMIT ?',(*last,chunk)).fetchall()
        if not rows:break
        with target:
            target.executemany('INSERT OR IGNORE INTO associations VALUES(?,?,?,?,?)',[tuple(row) for row in rows])
            last=[rows[-1]['organisation_id'],rows[-1]['domain'],rows[-1]['url']];setmeta('last_association',last)
            target.execute('INSERT OR REPLACE INTO seed_batches VALUES(?,?,?,?)',('associations',json.dumps(last),len(rows),identifier([dict(row) for row in rows])))
        print(json.dumps({'stage':'relationship_association_seed','batch_rows':len(rows),'last_organisation_id':last[0]}),flush=True)
    actual={'domains':target.execute('SELECT COUNT(*) FROM jobs').fetchone()[0],
            'associations':target.execute('SELECT COUNT(*) FROM associations').fetchone()[0],
            'initial_frontier_rows':target.execute('SELECT COUNT(*) FROM frontier WHERE kind=\'initial_site\'').fetchone()[0]}
    if actual['domains']!=expected['domains'] or actual['associations']!=expected['associations']:raise ValueError('Central queue changed or seed keys/counts do not reconcile; keep partial seed')
    report={'status':'complete_local_candidate_queue_seed','seeded_at':stamp(),'source_queue':str(source),'source_open_mode':'read_only',
        'source_counts':expected,'derived_counts':actual,'record_unit':'website candidate domain plus source organisation/domain/URL association; not verified company or website ownership',
        'no_canonical_database_access':True,'full_site_exhaustion_claimed':False,'market_completeness_verified':False}
    setmeta('seed_report',report);target.commit();target.close();save(output/'full-domain-seed-manifest.json',report);return report


class GraphTransport(Transport):
    def _check_robots(self,url,allowed_hosts):
        super()._check_robots(url,allowed_hosts)
        if self.min_interval>10:raise SourceBlocked('Publisher crawl-delay exceeds bounded worker wait; defer without an early request')


def _process_entry(job,output,overlay,max_pages,max_depth):
    observe_domain(job,Path(output),overlay,WaveBudget(),max_pages=max_pages,max_depth=max_depth,
        transport_factory=lambda:GraphTransport(max_requests=12,max_bytes=5000000,max_response_bytes=1500000,timeout=10,min_interval=.5,retries=0))


def bounded_observe(job,output,overlay,budget,*,max_pages=3,max_depth=1,timeout_seconds=90,worker_target=None):
    """Kill only a stalled, database-free domain process; preserve page receipts."""
    output=Path(output);guard(output);allowance=5000000
    if not budget.reserve(allowance):return {'job_id':job['job_id'],'domain':job['domain'],'status':'wave_resource_budget_deferred'}
    context=multiprocessing.get_context('spawn');process=context.Process(target=worker_target or _process_entry,args=(job,str(output),overlay,max_pages,max_depth));started=stamp();path=output/'domains'/(job['job_id']+'.json')
    previous_invocations=len(json.loads(path.read_text())['invocations']) if path.exists() else 0;charged=False
    try:
        process.start();process.join(timeout_seconds)
        if process.is_alive():
            process.terminate();process.join(5)
            if process.is_alive():process.kill();process.join()
            guard(output)
            state=json.loads(path.read_text()) if path.exists() else {'job_id':job['job_id'],'domain':job['domain'],'organisations':job['organisations'],
                'candidate_urls':job['candidate_urls'],'frontier':[{'url':job['candidate_urls'][0],'depth':0,'kind':'initial_site','status':'pending'}],
                'pages':[],'claims':[],'identity_matches':[],'invocations':[],'full_site_exhausted':False,'main_database_access':False}
            state.update(status='domain_walltime_requires_review',walltime_review={'started_at':started,'seconds_limit':timeout_seconds,
                'source_page_receipts_preserved':True,'request_or_body_meters_for_interrupted_process':'unknown','no_closed_or_negative_business_inference':True})
            state['invocations'].append({'observed_at':stamp(),'page_attempts':0,'interrupted_unmetered_domain_attempt':True,
                'transport':{'requests':None,'bytes_fetched':None},'declared_upper_request_bound':12,'declared_upper_body_bound':allowance})
            save(path,state);budget.finish(allowance,allowance);charged=True;return state
        guard(output)
        state=json.loads(path.read_text()) if path.exists() else {'job_id':job['job_id'],'domain':job['domain'],'organisations':job['organisations'],
            'candidate_urls':job['candidate_urls'],'frontier':[{'url':job['candidate_urls'][0],'depth':0,'kind':'initial_site','status':'pending'}],
            'pages':[],'claims':[],'identity_matches':[],'invocations':[],'full_site_exhausted':False,'main_database_access':False}
        if process.exitcode!=0:
            state.update(status='domain_child_error_requires_review',child_exitcode=process.exitcode)
            state['invocations'].append({'observed_at':stamp(),'page_attempts':0,'interrupted_unmetered_domain_attempt':True,
                'transport':{'requests':None,'bytes_fetched':None},'declared_upper_request_bound':12,'declared_upper_body_bound':allowance})
            save(path,state);budget.finish(allowance,allowance);charged=True;return state
        recent=state['invocations'][previous_invocations:]
        used=sum((item['transport']['bytes_fetched'] or 0) for item in recent);budget.finish(allowance,used);charged=True
        return state
    except BaseException:
        if process.is_alive():process.terminate();process.join(5)
        if not charged:budget.finish(allowance,allowance)
        raise


def sync_state(connection,state,max_depth):
    if state['status']=='wave_resource_budget_deferred':return
    existing=connection.execute('SELECT state_status FROM jobs WHERE domain=?',(state['domain'],)).fetchone()
    if existing and existing[0] in ('recursive_utility_link_hold','recursive_quality_link_hold'):return
    held=state['status'] in ('manual_review_hold','publisher_access_hold','network_retry_requires_review','domain_walltime_requires_review','domain_child_error_requires_review')
    available=any(p['status']=='pending' for p in state['frontier'])
    deferred=any(p['status']=='pending' for p in state['frontier'])
    queue_status='review_hold' if held else 'pending' if available else 'deferred_depth' if deferred else 'bounded_no_more_discovered'
    with connection:
        connection.execute('UPDATE jobs SET queue_status=?,state_status=?,attempt_waves=? WHERE domain=?',
            (queue_status,state['status'],sum(i['page_attempts']>0 for i in state['invocations']),state['domain']))
        connection.executemany('INSERT OR REPLACE INTO frontier VALUES(?,?,?,?,?,?,?)',[(state['domain'],p['url'],p['depth'],p['kind'],p['status'],p.get('error'),p.get('discovered_on')) for p in state['frontier']])


def select_candidates(connection,wave_domains,running=()):
    """Reserve a quarter for recursion and the rest for original coverage."""
    held=set(running);quota=max(1,wave_domains//4);limit=wave_domains+16
    active='EXISTS(SELECT 1 FROM research_candidates c WHERE c.domain=j.domain AND c.resolution_status=\'direct_link_candidate\')'
    recursive=connection.execute('SELECT j.* FROM jobs j JOIN research_domains r ON r.domain=j.domain WHERE j.queue_status=\'pending\' AND '+active+' ORDER BY j.attempt_waves,j.priority DESC LIMIT ?',(limit,)).fetchall()
    ordinary=connection.execute('SELECT j.* FROM jobs j WHERE j.queue_status=\'pending\' AND NOT ('+active+') ORDER BY j.attempt_waves,j.priority DESC LIMIT ?',(limit,)).fetchall()
    recursive=[row for row in recursive if row['domain'] not in held];ordinary=[row for row in ordinary if row['domain'] not in held]
    selected=recursive[:quota]+ordinary[:wave_domains-min(quota,len(recursive))];seen={row['domain'] for row in selected}
    for row in recursive+ordinary:
        if len(selected)>=wave_domains:break
        if row['domain'] not in seen:selected.append(row);seen.add(row['domain'])
    return selected


def collect(output,overlay_path,*,wave_domains=64,workers=4,max_pages=3,max_depth=1,continuous=True,email_queue=None,explicit_claims=()):
    from concurrent.futures import ThreadPoolExecutor,as_completed
    import fcntl
    if not 1<=wave_domains<=1000 or not 1<=workers<=8 or not 1<=max_pages<=20 or not 0<=max_depth<=4:raise ValueError('Explicit bounded worker/wave/page/depth parameters required')
    output=Path(output);guard(output);(output/'domains').mkdir(exist_ok=True)
    with (output/'collector.lock').open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        connection=initialise(output/'queue.sqlite');row=connection.execute('SELECT value_json FROM seed_meta WHERE key=\'seed_report\'').fetchone()
        if row is None:raise ValueError('Full central candidate queue seed has not reconciled')
        seed_report=json.loads(row[0]);source=seed_report['source_queue'];overlay=json.loads(Path(overlay_path).read_text()) if overlay_path else {'reviews':{}}
        for path in (output/'domains').glob('*.json'):sync_state(connection,json.loads(path.read_text()),max_depth)
        from .relationship_recursion import advance
        print(json.dumps({'stage':'recursive_relationship_advance','report':advance(connection,output,email_queue,explicit_claims)}),flush=True)
        wave=0
        while not (output/'pause-requested').exists():
            guard(output)
            with closing(connect(source,True)) as upstream:
                running={r[0] for r in upstream.execute('SELECT domain FROM jobs WHERE status IN (\'running\',\'observing\',\'in_progress\') OR status LIKE \'running:%\'').fetchall()}
            selected=select_candidates(connection,wave_domains,running)
            if not selected:break
            jobs=[]
            for row in selected:
                associations=connection.execute('''SELECT a.organisation_id,a.name,a.url FROM associations a WHERE a.domain=?
                  AND (a.organisation_id NOT LIKE 'relationship-candidate:%' OR EXISTS
                  (SELECT 1 FROM research_candidates c WHERE c.candidate_id=substr(a.organisation_id,24) AND c.resolution_status='direct_link_candidate'))
                  ORDER BY a.organisation_id,a.url''',(row['domain'],)).fetchall();organisations={}
                for association in associations:organisations.setdefault(association['organisation_id'],{'organisation_id':association['organisation_id'],'name':association['name'],'service_labels':[],'location_id':None})
                origin=connection.execute('SELECT candidate_id,root_domain,minimum_discovery_depth FROM research_domains WHERE domain=?',(row['domain'],)).fetchone()
                pending_depth=connection.execute('SELECT MIN(depth) FROM frontier WHERE domain=? AND status=\'pending\'',(row['domain'],)).fetchone()[0]
                seed_frontier=[dict(item) for item in connection.execute('SELECT url,depth,kind,status,discovered_on FROM frontier WHERE domain=? AND status=\'pending\'',(row['domain'],))]
                jobs.append({'job_id':row['id'],'domain':row['domain'],'candidate_urls':[row['url']],'organisations':list(organisations.values()),'operational_areas':[],
                    'research_origin':{'candidate_id':origin['candidate_id'],'root_domain':origin['root_domain'],'discovery_depth':origin['minimum_discovery_depth']} if origin else {},
                    'crawl_depth_this_wave':max(max_depth,pending_depth or 0),
                    'seed_frontier':seed_frontier,
                    'association_reference':{'derived_queue':str(output/'queue.sqlite'),'table':'associations','domain':row['domain']}})
            wave+=1;budget=WaveBudget();save(output/'active-wave-selection.json',{'wave':wave,'selected_at':stamp(),'domains':[{'job_id':j['job_id'],'domain':j['domain']} for j in jobs],
                'workers':workers,'max_pages_per_domain_wave':max_pages,'depth_bound_this_phase':max_depth,'domain_walltime_seconds':90,'wave_body_byte_budget':budget.maximum})
            collection_started=time.monotonic()
            storage_pause=False
            with ThreadPoolExecutor(max_workers=workers) as pool:
                futures={pool.submit(bounded_observe,job,output,overlay,budget,max_pages=max_pages,max_depth=job['crawl_depth_this_wave']):job for job in jobs}
                for future in as_completed(futures):
                    job=futures[future]
                    try:
                        state=future.result();sync_state(connection,state,max_depth)
                        print(json.dumps({'stage':'full_queue_relationship_observation','wave':wave,'domain':job['domain'],'status':state['status'],
                            'pages_total':len(state.get('pages',[])),'raw_heuristic_claims_total':len(state.get('claims',[]))}),flush=True)
                    except StorageHold as error:storage_pause=True;print(json.dumps({'status':'storage_paused','reason':str(error)}),flush=True)
            if storage_pause:break
            collection_seconds=time.monotonic()-collection_started
            export_started=time.monotonic()
            total=connection.execute('SELECT COUNT(*) FROM jobs').fetchone()[0]
            report=export_derived(output,range(total));report['full_queue_status_counts']={r[0]:r[1] for r in connection.execute('SELECT queue_status,COUNT(*) FROM jobs GROUP BY queue_status')}
            report['source_associations_persisted']=connection.execute('SELECT COUNT(*) FROM associations').fetchone()[0];save(output/'status.json',report)
            export_seconds=time.monotonic()-export_started
            review_started=time.monotonic()
            graph=review(output);print(json.dumps({'stage':'relationship_wave_summary','collection':report,'graph_review':graph}),flush=True)
            review_seconds=time.monotonic()-review_started
            advance_started=time.monotonic()
            print(json.dumps({'stage':'recursive_relationship_advance','report':advance(connection,output,email_queue,explicit_claims)}),flush=True)
            timing={'wave':wave,'workers':workers,'selected_domains':len(jobs),'collection_seconds':collection_seconds,'export_seconds':export_seconds,'review_seconds':review_seconds,'advance_seconds':time.monotonic()-advance_started,'observed_at':stamp()}
            with (output/'wave-timings.jsonl').open('a') as timing_file:timing_file.write(json.dumps(timing)+'\n')
            print(json.dumps({'stage':'relationship_wave_timing',**timing}),flush=True)
            if not continuous:break
        connection.close()


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--source-queue');parser.add_argument('--output',type=Path,required=True);parser.add_argument('--overlay')
    parser.add_argument('--seed',action='store_true');parser.add_argument('--collect',action='store_true');parser.add_argument('--wave-domains',type=int,default=64);parser.add_argument('--workers',type=int,default=4)
    parser.add_argument('--max-pages',type=int,default=3);parser.add_argument('--max-depth',type=int,default=1);parser.add_argument('--one-wave',action='store_true');parser.add_argument('--email-queue');parser.add_argument('--explicit-claims',action='append',default=[]);args=parser.parse_args()
    try:
        if args.seed:
            if not args.source_queue:parser.error('--seed needs --source-queue')
            print(json.dumps(seed(args.source_queue,args.output)),flush=True)
        if args.collect:collect(args.output,args.overlay,wave_domains=args.wave_domains,workers=args.workers,max_pages=args.max_pages,max_depth=args.max_depth,continuous=not args.one_wave,email_queue=args.email_queue,explicit_claims=args.explicit_claims)
    except StorageHold as error:print(json.dumps({'status':'storage_paused','reason':str(error),'main_database_writes':0}),flush=True)
