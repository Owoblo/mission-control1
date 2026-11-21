"""Compile scoped professional-role evidence from integrated research batches."""
import hashlib
import html
import json
from .windsor_physical_report import ROOT
from .windsor_batch_merge import validate_reference, validate_contacts


def build():
    rows, held, seen = [], [], set()
    for receipt in sorted((ROOT/'artifacts').glob('windsor-parallel-*/integration-receipt.json')):
        path = receipt.parent/'professional_roles.json'
        if not path.exists():
            continue
        for row in json.loads(path.read_text()):
            try:
                for field in ('person_name', 'organization', 'published_role', 'scope', 'checked_on'):
                    if not isinstance(row.get(field), str) or not row[field].strip():
                        raise ValueError('Missing '+field)
                evidence = validate_reference(row)
                validate_contacts(row)
                key = hashlib.sha256(json.dumps([row[k] for k in ('source_url','person_name','organization','published_role','scope')]).encode()).hexdigest()
                if key in seen:
                    continue
                seen.add(key)
                rows.append({**row, **evidence, 'role_observation_id': key,
                             'current_authority_independently_verified': False,
                             'outreach_eligible': False, 'batch_reference': str(path.relative_to(ROOT))})
            except (ValueError, KeyError, TypeError) as e:
                held.append({'batch': str(path.relative_to(ROOT)), 'person_name': row.get('person_name'), 'reason': str(e)})
    out = ROOT/'artifacts/windsor-role-register-20261029'
    out.mkdir(exist_ok=True)
    summary = {'role_observations': len(rows), 'distinct_name_organization_pairs': len({(r['person_name'],r['organization']) for r in rows}),
               'held': len(held), 'scope': 'Integrated parallel batches only; original Ortona evidence remains separately preserved. Published roles do not establish current purchasing authority or property ownership.'}
    (out/'roles.json').write_text(json.dumps({'summary':summary,'observations':rows,'held':held},indent=2)+'\n')
    cards = ''.join('<article><h2>'+html.escape(r['person_name'])+'</h2><p>'+html.escape(r['organization']+' — '+r['published_role'])+'</p><p>'+html.escape(r['scope'])+'</p><a href="'+html.escape(r['source_url'],quote=True)+'">Source</a></article>' for r in rows)
    (out/'index.html').write_text('<!doctype html><meta charset="utf-8"><title>Windsor professional roles</title><style>body{max-width:1000px;margin:40px auto;background:#101b28;color:#edf5ff;font:17px system-ui}article{padding:18px;border-bottom:1px solid #567}a{color:#72dfcb}</style><h1>Published professional roles</h1><p>'+html.escape(summary['scope'])+'</p>'+cards)
    print(json.dumps(summary,indent=2))


if __name__ == '__main__':
    build()
