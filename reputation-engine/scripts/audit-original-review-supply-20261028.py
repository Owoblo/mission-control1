"""Read-only inventory of original pilot candidates remaining after source review."""
import collections, json, runpy, re
from pathlib import Path
qualify=runpy.run_path('scripts/qualify-pilot-source-backlog-20261027.py')['qualify']

P=Path('artifacts/partnership-pilot-3000-20261027')
def lines(path):
    return [json.loads(x) for x in path.read_text().splitlines() if x.strip()]

def main():
    candidates=json.loads((P/'candidates.json').read_text())
    src={r['organisation_id']:r for r in lines(P/'source-refresh.jsonl')}
    tech={r['organisation_id']:r for r in lines(P/'role-inclusive-review.jsonl')}
    reviewed=set();admitted=set()
    for path in P.glob('*source.jsonl'):
        for r in lines(path):
            if r.get('organisation_id'): reviewed.add(r['organisation_id'])
    for path in [P/'first-reviewed-admission.json',*P.glob('additional-reviewed-*.json')]:
        try: rows=json.loads(path.read_text()).get('records',[])
        except (json.JSONDecodeError, FileNotFoundError):continue
        admitted.update(r.get('organisation_id') for r in rows if r.get('jobId'))
    counts=collections.Counter();strict=[];types=collections.Counter();examples=[]
    for c in candidates:
        oid=c['organisation_id']
        if oid in reviewed or oid in admitted:continue
        counts['unreviewed_unadmitted']+=1
        s=src.get(oid,{});t=tech.get(oid,{})
        if t.get('technical_screen_status')=='advance_to_identity_and_eligibility_review':counts['technical_high']+=1
        if s.get('target_email_observed'):counts['email_observed']+=1
        if not s.get('restriction_signals'):counts['no_source_restriction_signal']+=1
        if s.get('target_email_observed') and not s.get('restriction_signals') and t.get('technical_screen_status')=='advance_to_identity_and_eligibility_review':
            counts['technical_high_source_observed']+=1
            types[c['email'].split('@')[0].lower()]+=1
            same_domain=c['email'].lower().split('@')[1]==c['domain'].lower().removeprefix('www.')
            if same_domain:counts['same_domain']+=1
            matched=[]
            for p in s.get('pages',[]):
                if not p.get('target_email_observed'):continue
                context=' '.join([p.get('page_identity_excerpt') or '',p.get('target_context') or '',*(p.get('target_contexts') or [])]).lower()
                if c['email'].lower() not in context:continue
                matched.append(context)
            if matched:counts['email_in_saved_page']+=1
            if same_domain and matched:counts['same_domain_and_email_in_page']+=1
            if any(c['city'].lower() in x for x in matched):counts['city_in_page']+=1
            if any(re.search(r'\b[KLMNP]\d[A-Z][ -]?\d[A-Z]\d\b',x,re.I) for x in matched):counts['postal_in_page']+=1
            name=re.sub(r'\b(incorporated|limited|inc|ltd|llc|corp)\b\.?','',c['organisation_name'],flags=re.I).strip()
            norm=lambda x:re.sub('[^a-z0-9]','',x.lower())
            if any(norm(name) in norm(x) for x in matched):counts['name_in_page']+=1
            if same_domain and any(c['city'].lower() in x and norm(name) in norm(x) for x in matched):
                counts['same_domain_name_city_page']+=1
                local=c['email'].split('@')[0].lower()
                if local in {'info','hello','contact','office','admin','enquiries','inquiries','enquiry','inquiry','general'}:
                    counts['same_domain_general_name_city_page']+=1
                    if any(re.search(r'\b[KLMNP]\d[A-Z][ -]?\d[A-Z]\d\b',x,re.I) for x in matched):counts['same_domain_general_name_city_postal_page']+=1
            if len(examples)<20:examples.append({'organisation_id':oid,'name':c['organisation_name'],'city':c['city'],'email':c['email'],'domain':c['domain']})
        if t.get('technical_screen_status')=='advance_to_identity_and_eligibility_review' and qualify(c,s):strict.append(oid)
    print(json.dumps({'counts':counts,'strict_new':len(strict),'mailbox_local_parts_top':types.most_common(25),'examples':examples},indent=2))
if __name__=='__main__':main()
