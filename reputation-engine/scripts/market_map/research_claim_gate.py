"""Offline claim triage. Passing literal evidence never grants semantic approval."""
import argparse
import hashlib
import json
from pathlib import Path


def triage(result, packet, *, escalation_count=0):
    sources = {s['url']: ' '.join(s['text'].split()).casefold() for s in packet['sources']}
    rows = []
    for index, claim in enumerate(result.get('claims', [])):
        quote = ' '.join(claim.get('exact_quote', '').split()).casefold()
        reasons = []
        if claim.get('source_url') not in sources:
            reasons.append('source_missing')
        elif not quote or quote not in sources[claim['source_url']]:
            reasons.append('quotation_not_literal')
        if len(quote) < 20:
            reasons.append('quotation_too_short')
        if not all(isinstance(claim.get(k), str) and claim[k].strip() for k in
                   ('organization', 'relationship_or_role', 'fact')):
            reasons.append('required_field_missing')
        # No self-assessed confidence or expensive-model label bypasses review.
        route = 'semantic_review'
        if 'source_missing' in reasons:
            route = 'source_acquisition'
        elif reasons:
            route = 'stronger_model_review' if escalation_count < 1 else 'unresolved'
        rows.append({'claim_index': index, 'route': route, 'reasons': reasons,
                     'claim': claim, 'semantic_approved': False, 'outreach_eligible': False})
    return {'claims': rows, 'unknowns': result.get('unknowns', []),
            'automatic_promotions': 0, 'scope': 'literal triage only; omissions require independent review'}


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--packet', type=Path, required=True)
    p.add_argument('--claims', type=Path, required=True)
    p.add_argument('--output', type=Path, required=True)
    p.add_argument('--escalation-count', type=int, choices=(0, 1), default=0)
    a = p.parse_args()
    report = triage(json.loads(a.claims.read_text()), json.loads(a.packet.read_text()),
                    escalation_count=a.escalation_count)
    report['input_sha256'] = hashlib.sha256(a.claims.read_bytes()).hexdigest()
    a.output.parent.mkdir(parents=True, exist_ok=True)
    with a.output.open('x') as f:
        json.dump(report, f, indent=2)
    print(json.dumps({'claims': len(report['claims']), 'automatic_promotions': 0,
                      'routes': {r: sum(x['route'] == r for x in report['claims'])
                                 for r in sorted({x['route'] for x in report['claims']})}}))
