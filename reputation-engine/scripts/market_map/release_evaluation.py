"""Independent saved-result scoring and fail-closed project release criteria."""
import argparse,hashlib,json,math,random,tempfile,sys
from pathlib import Path
from .release_corpus import load_corpus,canonical,clusters,DIMENSIONS,require

VERSION='ssm-release-evaluation/1'
METRICS=['email','phone','phone_kind','extension','email_normalization','phone_normalization',
         'organization','site','person','shared_ambiguity','unknown_ownership','entity_pairs','provenance']
OPERATIONS=['retry_recovery','retry_exhaustion','interrupted_worker','duplicate_receipts','stale_leases',
 'sqlite_contention','cache_corruption','permission_revocation','robots_changes','conditional_revalidation',
 'process_concurrency','cross_coordinator_host_budget','source_freshness','parser_replay','disk_retention','backup_restore','suppression']

def wilson(success,total):
    if not total:return None
    z=1.959963984540054;p=success/total;d=1+z*z/total
    mid=(p+z*z/(2*total))/d;half=z*math.sqrt(p*(1-p)/total+z*z/(4*total*total))/d
    return [max(0,mid-half),min(1,mid+half)]

def metric(pred,truth):
    tp=len(pred&truth);fp=len(pred-truth);fn=len(truth-pred)
    return {'tp':tp,'fp':fp,'fn':fn,'predicted':tp+fp,'expected':tp+fn,
      'precision':tp/(tp+fp) if tp+fp else None,'recall':tp/(tp+fn) if tp+fn else None,
      'f1':2*tp/(2*tp+fp+fn) if 2*tp+fp+fn else None,
      'precision_wilson95':wilson(tp,tp+fp),'recall_wilson95':wilson(tp,tp+fn)}

def sets_for(page,observations,entities,*,gold=False):
    out={k:set() for k in METRICS};accepted=[o for o in observations if o.get('status')==('supported' if gold else 'accepted')]
    for o in observations:
        channel=o['channel'];loc=o.get('locator');raw=o.get('raw')
        # Observation normalization is scored separately from page-unique channel recovery.
        status='accepted' if gold and o['status']=='supported' else o['status']
        out[channel+'_normalization'].add((loc,raw,status,o.get('normalized')))
    for o in accepted:
        c=o['channel'];v=o.get('normalized');out[c].add((v,))
        if c=='phone':
            out['phone_kind'].add((v,o.get('kind')));out['extension'].add((v,o.get('extension')))
        if o.get('ownership')=='shared':out['shared_ambiguity'].add((c,v))
        if o.get('ownership')=='unknown':out['unknown_ownership'].add((c,v))
        # Unknown gold owners have no supported edges; an asserted edge is a false positive.
        for owner in o.get('owners',[]):
            if owner.get('status','supported' if gold else 'asserted')==('supported' if gold else 'asserted'):
                out[owner['type']].add((c,v,owner['id']))
        valid=gold or (bool(o.get('locator')) and bool(o.get('raw')) and bool(o.get('method')) and bool(o.get('version')) and o.get('capture_sha256')==page['sha256'] and o.get('source_url')==page['url'])
        if valid:out['provenance'].add((o['id'],))
    # Only declared record assignments form merge/split pairs; omissions are reported separately.
    for i,a in enumerate(entities):
        for b in entities[i+1:]:
            if a.get('entity_id') and a.get('entity_id')==b.get('entity_id'):out['entity_pairs'].add(tuple(sorted([a['record_id'],b['record_id']])))
    return out

def compare(manifest,labels,predictions,*,bootstrap_samples=400):
    pages=manifest['captures'];require(set(predictions)=={p['id'] for p in pages},'prediction capture coverage mismatch')
    groups=clusters(pages);per_page={};errors=[];fax=0;fax_denominator=0;wrong_owner=0;abstained=0;accepted=0;missing_entities=0;extension_correct=0;extension_total=0
    businesses=set();yield_set=set();supported_expected=0;full_expected=0
    for p in pages:
        pid=p['id'];gold=labels[pid];actual=predictions[pid];require(actual['capture_sha256']==p['sha256'],'prediction capture hash mismatch')
        require(actual.get('versions'),'prediction versions missing')
        obs=actual['observations'];require(len({o['id'] for o in obs})==len(obs),'duplicate predicted occurrence id')
        require(all(o['channel'] in {'email','phone'} and o['status'] in {'accepted','invalid','unsupported'} for o in obs),'prediction channel/status')
        for o in obs:
            require(o['status']!='accepted' or bool(o.get('normalized')),'accepted empty contact')
            for e in o.get('owners',[]):require(e['type'] in {'organization','site','person'},'prediction owner type')
        entity_records=[r['record_id'] for r in actual.get('entities',[])]
        require(len(entity_records)==len(set(entity_records)),'duplicate predicted entity record')
        require(set(entity_records)<={r['record_id'] for r in gold.get('entities',[])},'unknown entity record')
        expected=sets_for(p,gold['observations'],gold.get('entities',[]),gold=True);pred=sets_for(p,obs,actual.get('entities',[]));per_page[pid]=(pred,expected)
        for (number,) in pred['phone'] & expected['phone']:
            extension_total+=1
            extension_correct+=({ext for value,ext in pred['extension'] if value==number}=={ext for value,ext in expected['extension'] if value==number})
        # Provenance completeness denominator is all accepted candidates, including false positives.
        expected['provenance']={(o['id'],) for o in obs if o['status']=='accepted'}
        accepted+=sum(o['status']=='accepted' for o in obs)
        abstained+=sum(o['status']=='accepted' and not any(e.get('status','asserted')=='asserted' for e in o.get('owners',[])) for o in obs)
        missing_entities+=len({r['record_id'] for r in gold.get('entities',[])}-{r['record_id'] for r in actual.get('entities',[]) if r.get('entity_id')})
        goldfax={o['normalized'] for o in gold['observations'] if o['status']=='supported' and o['channel']=='phone' and o.get('kind')=='fax'}
        ordinary={o['normalized'] for o in gold['observations'] if o['status']=='supported' and o['channel']=='phone' and o.get('kind')=='phone'}
        fax_denominator+=len(goldfax-ordinary)
        fax+=len({o.get('normalized') for o in obs if o['channel']=='phone' and o['status']=='accepted' and o.get('kind')=='phone'} & (goldfax-ordinary))
        businesses.update(p['business_ids'])
        supported_expected+=sum(o['status']=='supported' for o in gold['observations']);full_expected+=len(gold['observations'])
        for o in gold['observations']:
            if o['status']!='supported':continue
            for e in o.get('owners',[]):
                edge=(o['channel'],o['normalized'],e['id'])
                if e['type'] in {'organization','site'} and e.get('business_id') and edge in pred[e['type']] and (o['normalized'],) in pred[o['channel']]:yield_set.add((e['business_id'],o['channel'],o['normalized']))
        for name in METRICS:
            for outcome,items in [('false_positive',pred[name]-expected[name]),('false_negative',expected[name]-pred[name])]:
                for value in sorted(items,key=canonical):
                    if name in {'organization','site','person'} and outcome=='false_positive':wrong_owner+=1
                    category='Incorrect attribution' if name in {'organization','site','person','shared_ambiguity','unknown_ownership'} else 'Duplicate/entity resolution error' if name=='entity_pairs' else 'Incorrect channel type' if name=='phone_kind' else 'Normalization error' if name.endswith('_normalization') else 'Unknown or insufficient evidence'
                    # A metric mismatch establishes the discrepancy, not its upstream root cause.
                    errors.append({'capture_id':pid,'metric':name,'outcome':outcome,'value':list(value),
                      'expected':list(value) if outcome=='false_negative' else None,'actual':list(value) if outcome=='false_positive' else None,
                      'category':category,'stage_responsible':None,'basis':'observed mismatch; upstream cause unverified',
                      'source':{'url':p['url'],'file':p['file'],'sha256':p['sha256'],'labels':gold['observations']},
                      'actual_observations':obs,'diagnostics':actual.get('diagnostics',[]),'versions':actual['versions'],
                      'regression_status':'uncompared','proposed_fix':'Inspect the linked occurrence and diagnostics; reproduce and locate the responsible stage before changing extraction.'})
    scores={}
    for name in METRICS:
        pred={(pid,*v) for pid,(a,b) in per_page.items() for v in a[name]};truth={(pid,*v) for pid,(a,b) in per_page.items() for v in b[name]}
        scores[name]=metric(pred,truth)
    # Deterministic cluster bootstrap, resampling whole connected domain/template families.
    unique=sorted(set(groups.values()));rng=random.Random(170017);samples={n:{k:[] for k in ['precision','recall','f1']} for n in METRICS}
    group_counts={name:{g:[0,0,0] for g in unique} for name in METRICS}
    for pid,(a,b) in per_page.items():
        for name in METRICS:
            c=group_counts[name][groups[pid]]
            c[0]+=len(a[name]&b[name]);c[1]+=len(a[name]-b[name]);c[2]+=len(b[name]-a[name])
    for _ in range(bootstrap_samples if len(unique)>=2 else 0):
        chosen=[rng.choice(unique) for _ in unique]
        for name in METRICS:
            tp,fp,fn=[sum(group_counts[name][g][i] for g in chosen) for i in range(3)]
            values={'precision':tp/(tp+fp) if tp+fp else None,'recall':tp/(tp+fn) if tp+fn else None,'f1':2*tp/(2*tp+fp+fn) if 2*tp+fp+fn else None}
            for k,v in values.items():
                if v is not None:samples[name][k].append(v)
    for name in METRICS:
        scores[name]['cluster_bootstrap95']={k:[sorted(v)[int(.025*(len(v)-1))],sorted(v)[int(.975*(len(v)-1))]] if v else None for k,v in samples[name].items()}
    for error in errors:
        value=error['value'];pid=error['capture_id']
        diagnostic=next((d for d in predictions[pid].get('diagnostics',[]) if isinstance(d,dict) and d.get('candidate_value') is not None and d.get('candidate_value') in value and d.get('status') in {'unsupported','invalid'}),None)
        if diagnostic:
            error.update(category='Unsupported format' if diagnostic['status']=='unsupported' else 'Normalization error',stage_responsible='normalization',basis='observed candidate normalization diagnostic',responsible_evidence=diagnostic)
            error['proposed_fix']='Review the explicit normalization reason and declared format support; retain raw values and do not transliterate unsupported published addresses.'
        elif error['category']=='Incorrect attribution':error['proposed_fix']='Inspect occurrence/card/node boundaries and owner IDs; preserve unresolved edges instead of promoting host-level candidates.'
        elif error['category']=='Incorrect channel type':error['proposed_fix']='Inspect bounded phone/fax label evidence and add a regression for the observed channel mismatch.'
    # Entity pair evaluation spans captures: shared offices/branches often cross pages.
    assignments=[]
    for p in pages:
        pid=p['id'];predicted={e['record_id']:e.get('entity_id') for e in predictions[pid].get('entities',[])}
        assignments.extend((pid+':'+e['record_id'],e.get('entity_id'),predicted.get(e['record_id'])) for e in labels[pid].get('entities',[]))
    truth_pairs=set();pred_pairs=set()
    for i,a in enumerate(assignments):
        for b in assignments[i+1:]:
            pair=tuple(sorted([a[0],b[0]]))
            if a[1] and a[1]==b[1]:truth_pairs.add(pair)
            if a[2] and a[2]==b[2]:pred_pairs.add(pair)
    scores['entity_pairs']=metric(pred_pairs,truth_pairs)
    scores['entity_pairs']['cluster_bootstrap95']=None
    errors=[e for e in errors if e['metric']!='entity_pairs']
    for outcome,items in [('false_positive',pred_pairs-truth_pairs),('false_negative',truth_pairs-pred_pairs)]:
        for pair in sorted(items):errors.append({'capture_id':'cross_capture','metric':'entity_pairs','outcome':outcome,'value':list(pair),'expected':list(pair) if outcome=='false_negative' else None,'actual':list(pair) if outcome=='false_positive' else None,'category':'Duplicate/entity resolution error','stage_responsible':None,'basis':'observed pair mismatch; upstream cause unverified','source':{'assignments':assignments},'versions':{p['id']:predictions[p['id']]['versions'] for p in pages},'regression_status':'uncompared','proposed_fix':'Inspect source-scoped record assignments before changing merge logic.'})
    business_groups={b:groups[p['id']] for p in pages for b in p['business_ids']}
    yields=[];rng=random.Random(170017)
    if len(unique)>=2:
        gc={g:sum(business_groups[b]==g for b,c,v in yield_set) for g in unique}
        gb={g:sum(value==g for value in business_groups.values()) for g in unique}
        for _ in range(bootstrap_samples):
            draw=[rng.choice(unique) for _ in unique];den=sum(gb[g] for g in draw)
            if den:yields.append(sum(gc[g] for g in draw)/den)
    yield_interval=[sorted(yields)[int(.025*(len(yields)-1))],sorted(yields)[int(.975*(len(yields)-1))]] if yields else None
    return {'metrics':scores,'errors':errors,'capture_count':len(pages),'independent_clusters':len(unique),
       'extension_accuracy':{'correct_extension_sets':extension_correct,'matched_base_phone_values':extension_total,'accuracy':extension_correct/extension_total if extension_total else None,'wilson95':wilson(extension_correct,extension_total)},'fax_as_phone':fax,'fax_evaluation':{'misclassified':fax,'fax_only_values':fax_denominator,'error_rate':fax/fax_denominator if fax_denominator else None,'wilson95':wilson(fax,fax_denominator)},'wrong_owner_edges':wrong_owner,'abstention':{'count':abstained,'accepted_occurrences':accepted,'rate':abstained/accepted if accepted else None,'wilson95':wilson(abstained,accepted)},
       'entity_resolution':{'false_merges':scores['entity_pairs']['fp'],'false_splits':scores['entity_pairs']['fn'],'unassigned_records':missing_entities},
       'end_to_end':{'correct_contacts':len(yield_set),'input_businesses':len(businesses),'contacts_per_business':len(yield_set)/len(businesses) if businesses else None,'correct_contact_keys':sorted(yield_set),'contacts_per_business_cluster_bootstrap95':yield_interval,'businesses_with_correct_contact':len({b for b,c,v in yield_set}),'business_coverage_wilson95':wilson(len({b for b,c,v in yield_set}),len(businesses))},
       'label_support':{'supported_occurrences':supported_expected,'all_labeled_occurrences':full_expected},
       'interval_notes':'Wilson intervals assume independent Bernoulli observations and are diagnostic; clustered bootstrap uses connected domain/template families, seed 170017. Sparse/perfect samples can give degenerate bootstrap intervals. Neither corrects unrepresentative sampling.'}

def delta(candidate,baseline):
    key=lambda e:canonical([e['capture_id'],e['metric'],e['outcome'],e['value']])
    prior={key(e):e for e in baseline['errors']};now={key(e):e for e in candidate['errors']}
    for k,e in now.items():e['regression_status']='pre_existing' if k in prior else 'new'
    return {'new_errors':sorted(now.keys()-prior.keys()),'resolved_errors':[prior[k] for k in sorted(prior.keys()-now.keys())]}

def gates(manifest,holdout,safety,operations):
    blockers=[];h=[p for p in manifest['captures'] if p['split']=='holdout'];real=manifest['corpus_kind']=='real'
    if not real or len(manifest['captures'])<300 or len(h)<100 or holdout['independent_clusters']<50:blockers.append('Representative approved real corpus: >=300 captures, >=100 holdout, >=50 holdout clusters required')
    for field,choices in DIMENSIONS.items():
        for choice in sorted(choices):
            if sum(p[field]==choice for p in h)<10:blockers.append('Holdout coverage <10: '+field+'='+choice)
    for name in ['email','phone','organization','site','person']:
        s=holdout['metrics'][name]
        if s['precision'] is None or s['precision']<.99 or s['precision_wilson95'] is None or s['precision_wilson95'][0]<.98:blockers.append(name+': precision >=99% and diagnostic Wilson lower bound >=98% not established')
        if s['recall'] is None or s['recall']<.90:blockers.append(name+': supported recall >=90% not established')
    if holdout['metrics']['provenance']['recall']!=1:blockers.append('Complete accepted-contact provenance not demonstrated')
    if not safety or not safety['capture_count'] or safety['wrong_owner_edges'] or safety['fax_as_phone']:blockers.append('Adversarial safety zero wrong-owner/fax failures not established')
    if not safety or not safety['metrics']['person']['expected'] or not safety['metrics']['phone_kind']['expected']:blockers.append('Safety set lacks person/channel denominators')
    for name in OPERATIONS:
        row=operations.get(name,{})
        if row.get('status')!='pass' or not row.get('evidence'):blockers.append('Operational evidence missing/failing: '+name)
    # Passing statistical checks remains a proposal requiring external corpus and policy review.
    return {'criteria_version':'project-proposal/1','broad_production':'NO_GO' if blockers else 'REVIEW_REQUIRED',
      'bounded_live_pilot':'NO_GO' if blockers else 'REVIEW_REQUIRED','offline_shadow_evaluation':'GO',
      'blockers':blockers,'authorization':'Never authorizes crawls, outreach, deployment or release; owner/security review remains mandatory.'}

def evaluate(manifest,labels,predictions,*,operations=None,baseline=None,safety=None):
    full=compare(manifest,labels,predictions)
    fingerprint=hashlib.sha256(canonical(manifest).encode()).hexdigest()
    if baseline:
        require(baseline['manifest_sha256']==fingerprint,'baseline labels/captures/splits changed')
        full['delta']=delta(full,baseline['all'])
    h={**manifest,'captures':[p for p in manifest['captures'] if p['split']=='holdout']}
    holdout=compare(h,{p['id']:labels[p['id']] for p in h['captures']},{p['id']:predictions[p['id']] for p in h['captures']})
    strata={}
    for dim in DIMENSIONS:
        for value in sorted({p[dim] for p in h['captures']}):
            sub={**h,'captures':[p for p in h['captures'] if p[dim]==value]}
            result=compare(sub,{p['id']:labels[p['id']] for p in sub['captures']},{p['id']:predictions[p['id']] for p in sub['captures']},bootstrap_samples=0)
            strata[dim+'='+value]={'capture_count':result['capture_count'],'metrics':result['metrics']}
    return {'version':VERSION,'manifest_sha256':fingerprint,'label_sha256':manifest['labels_sha256'],'all':full,'holdout':holdout,'strata':strata,'release':gates(manifest,holdout,safety,operations or {})}


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--manifest',required=True);choice=parser.add_mutually_exclusive_group(required=True);choice.add_argument('--predictions');choice.add_argument('--replay',action='store_true');parser.add_argument('--operations');parser.add_argument('--safety-manifest');parser.add_argument('--safety-predictions');parser.add_argument('--baseline');parser.add_argument('--output',required=True);args=parser.parse_args()
    output=Path(args.output).resolve();require(not output.exists() and output.is_relative_to(Path(tempfile.gettempdir()).resolve()),'new temp output required')
    from .offline_guard import OfflineGuard
    guard=OfflineGuard(output);guard.install();output.mkdir()
    m,l,b=load_corpus(args.manifest)
    from .release_replay import replay
    pred=replay(m,b) if args.replay else json.loads(Path(args.predictions).read_text())
    (output/'predictions.json').write_text(json.dumps(pred,indent=2,ensure_ascii=False)+'\n')
    safety=None
    if args.safety_manifest:
        sm,sl,sb=load_corpus(args.safety_manifest)
        require(sm['corpus_kind']=='synthetic' and all(p['split']=='safety' for p in sm['captures']),'separate synthetic safety set required')
        sp=replay(sm,sb) if args.replay else json.loads(Path(args.safety_predictions).read_text())
        safety=compare(sm,sl,sp)
        (output/'safety.json').write_text(json.dumps(safety,indent=2)+'\n')
    result=evaluate(m,l,pred,operations=json.loads(Path(args.operations).read_text()) if args.operations else None,safety=safety,baseline=json.loads(Path(args.baseline).read_text()) if args.baseline else None)
    result['prediction_sha256']=hashlib.sha256(canonical(pred).encode()).hexdigest()
    result['source_hashes']={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in Path(__file__).parent.glob('*.py')}
    (output/'evaluation.json').write_text(json.dumps(result,indent=2,ensure_ascii=False)+'\n')
    require(not guard.violations,'unexpected offline IO');print(json.dumps(result['release']))
    return 2 if result['release']['broad_production']=='NO_GO' else 0
if __name__=='__main__':sys.exit(main())
