"""Windsor-first city handoff with shared budgets and explicit coverage gaps."""
import hashlib
import json
from pathlib import Path
import sqlite3
import time

from .site_research_campaign import campaign, DISTRICTS
from .site_research_queue import SiteResearchQueue
from .source_capture_cache import atomic


def local_path(root, relative):
    root=Path(root).resolve()
    path=(root/relative).resolve()
    if root not in path.parents:raise ValueError('City artifact outside research root')
    return path


def provision(root, city):
    db=local_path(root,city['db']);db.parent.mkdir(parents=True,exist_ok=True)
    if not city.get('seed'):
        if not db.exists():raise ValueError('Existing city queue missing')
        return db
    raw=local_path(root,city['seed']).read_bytes()
    if hashlib.sha256(raw).hexdigest()!=city['seed_sha256']:raise ValueError('City seed hash mismatch')
    seed=json.loads(raw)
    if seed['municipality']!=city['name'] or seed['canonical_geography_id']!=city['geography_id']:
        raise ValueError('City seed identity mismatch')
    q=SiteResearchQueue(db)
    try:
        if q.db.execute('SELECT 1 FROM imports WHERE import_id=?',(city['seed_sha256'],)).fetchone():return db
        if q.db.execute('SELECT count(*) FROM sites').fetchone()[0]:raise ValueError('Changed seed requires reconciliation')
        q.db.execute('BEGIN IMMEDIATE')
        for site in seed['sites']:
            if site['municipality']!=city['name'] or site['district'] not in city['districts']:
                raise ValueError('Seed task outside configured scope')
            if not site['addresses'] or not site['members']:raise ValueError('Missing site foundation')
            q.db.execute('INSERT INTO sites(site_id,municipality,district,addresses,category,state,updated_at) VALUES(?,?,?,?,?,?,?)',
                (site['site_id'],city['name'],site['district'],json.dumps(site['addresses']),site['category'],'pending',time.time()))
            for member in site['members']:
                q.db.execute('INSERT INTO members VALUES(?,?,?)',(site['site_id'],member['building_id'],json.dumps(member)))
        q.db.execute('INSERT INTO imports VALUES(?,?,?)',(city['seed_sha256'],json.dumps({'seed':city['seed'],
            'canonical_geography_id':city['geography_id'],'held_buildings':len(seed.get('held_buildings',[]))}),time.time()))
        q.db.commit()
    except Exception:q.db.rollback();raise
    finally:q.close()
    return db


def queue_summary(db, municipality):
    conn=sqlite3.connect(db.as_uri()+'?mode=ro',uri=True)
    try:
        total=conn.execute('SELECT count(*) FROM sites WHERE municipality=?',(municipality,)).fetchone()[0]
        saved=conn.execute('SELECT count(*) FROM research_results r JOIN sites s USING(site_id) WHERE municipality=?',(municipality,)).fetchone()[0]
        return {'site_tasks':total,'saved_investigations':saved,'without_saved_investigation':total-saved,
            'market_complete':False,'tenant_coverage_complete':False}
    finally:conn.close()


def coordinate(root, manifest_path, output, max_sites=4000, max_api_calls=11280,
               campaign_fn=campaign, on_city=None, sites_per_city_turn=0):
    if isinstance(sites_per_city_turn,bool) or not isinstance(sites_per_city_turn,int) or not 0<=sites_per_city_turn<=100:
        raise ValueError('City turn quota must be 0 (legacy pass) or 1-100 sites')
    root=Path(root).resolve();output=Path(output);output.mkdir(parents=True,exist_ok=True)
    manifest=json.loads(Path(manifest_path).read_text());cities=manifest['cities']
    if not cities or cities[0]['name']!='Windsor':raise ValueError('Windsor must remain first')
    if len({c['geography_id'] for c in cities})!=len(cities):raise ValueError('Duplicate canonical cities')
    status={'state':'starting','cities':[{'municipality':c['name'],'geography_id':c['geography_id'],
        'configured_labels':c['configured_labels'],'state':'queued' if c['status']=='ready' else 'foundation_required',
        'site_tasks':c.get('site_tasks'),'foundation_held_buildings':c.get('held_buildings',0),
        'market_complete':False} for c in cities], 'configured_labels':len(manifest['configured_labels']),
        'municipalities':len(cities),'limits':{'max_sites':max_sites,'max_api_calls':max_api_calls,
        'sites_per_city_turn':sites_per_city_turn},'mode':'bounded_city_turns' if sites_per_city_turn else 'windsor_first_eligible_pass'}
    path=output/'city-progress.json'
    def save():atomic(path,json.dumps(status,indent=2).encode())
    def spent():
        calls=sites=0
        for c in cities:
            if c.get('output'):
                ledger=local_path(root,c['output'])/'campaign.json'
                if ledger.exists():
                    record=json.loads(ledger.read_text());calls+=record['api_requests_started'];sites+=len(record['attempted_ids'])
        return calls,sites
    for city,row in zip(cities,status['cities']):
        if city['status']!='ready':
            row.update(state='foundation_required',reason=city.get('reason'),layer_status=city.get('layer_status',{}));save();continue
        db=provision(root,city);work=local_path(root,city['output'])
        previous=json.loads((work/'campaign.json').read_text()) if (work/'campaign.json').exists() else {}
        # Never hide technical/billing/interruption holds by moving to another city.
        prior_status=previous.get('status')
        if prior_status and prior_status not in ('no_eligible_sites_remaining','site_limit_reached','ready','running'):
            row['state']=prior_status;status['state']='city_requires_attention';save();return status
        used_calls,used_sites=spent()
        status['api_requests_started']=used_calls;status['sites_attempted']=used_sites
        if used_calls>=max_api_calls-2 or used_sites>=max_sites:
            status['state']='global_budget_reached';save();return status
        if (output/'STOP').exists():status['state']='operator_stop';save();return status
        status.update(state='researching',active_city=city['name'],active_output=city['output'],active_db=city['db'])
        row['state']='researching';save()
        if on_city:on_city(city)
        new_site_allowance=min(max_sites-used_sites,sites_per_city_turn) if sites_per_city_turn else max_sites-used_sites
        new_call_allowance=min(max_api_calls-used_calls,new_site_allowance*4) if sites_per_city_turn else max_api_calls-used_calls
        result=campaign_fn(db,root,work,municipality=city['name'],districts=city.get('districts',list(DISTRICTS)),
            max_sites=new_site_allowance+len(previous.get('attempted_ids',[])),
            max_api_calls=new_call_allowance+previous.get('api_requests_started',0))
        row.update(queue_summary(db,city['name']),state=result['status'],
            foundation_held_buildings=city.get('held_buildings',0))
        if sites_per_city_turn and result['status']=='site_limit_reached':
            row['state']='city_turn_quota_reached_with_gaps';save();continue
        if result['status']!='no_eligible_sites_remaining':
            status['state']=result['status'];save();return status
        # Exhausted eligible pass is not a completed city; preserve review counts.
        row['state']='eligible_pass_exhausted_with_gaps';save()
    status['state']='bounded_city_turns_completed_with_gaps' if sites_per_city_turn else 'prepared_city_passes_exhausted';status['api_requests_started'],status['sites_attempted']=spent()
    save();return status
