"""Prepare and validate consecutive immutable fresh-cohort batches.

Stops on any error. Each paid SES validation request is recorded by the
underlying bounded validator before it is sent; ambiguous attempts are not
retried automatically. This script never admits or sends outreach email.
"""
import argparse
import json
from pathlib import Path
import subprocess
from datetime import datetime, timezone

ROOT = Path('artifacts/partnership-next-day-research-20261028')
PREPARATION = ROOT / 'preparation-20261028-0445'


def run(args):
    result = subprocess.run(args, check=True, text=True, capture_output=True)
    return json.loads(result.stdout.strip())


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--start', type=int, required=True)
    parser.add_argument('--count', type=int, required=True)
    args = parser.parse_args()
    if args.start < 7 or not 1 <= args.count <= 70:
        raise ValueError('Expected start >= 7 and 1..70 batches')
    progress = ROOT / 'fresh-validation-batches-progress.json'
    completed = []
    for index in range(args.start, args.start + args.count):
        batch = ROOT / f'verification-batch-{index:03d}'
        if batch.exists():
            raise ValueError(f'Immutable batch already exists: {batch}')
        prepared = run(['python3', '-m', 'scripts.market_map.prepare_fresh_verification_batch',
                        '--preparation', str(PREPARATION), '--output', str(batch), '--limit', '100'])
        if prepared['count'] == 0:
            break
        validation = run(['node', 'scripts/validate-fresh-cohort-bounded-20261028.mjs', str(batch), '--run'])
        if validation['errors'] or validation['new_paid_requests'] + validation['reused'] != prepared['count']:
            raise RuntimeError(f'Validation incomplete for {batch}; stop before creating more batches')
        technical = run(['node', 'scripts/prepare-fresh-cohort-review-20261028.mjs', str(batch)])
        if technical['provider_receipts'] + validation['reused'] != prepared['count']:
            raise RuntimeError(f'Provider receipts incomplete for {batch}')
        row = {'root': str(batch), 'selected': prepared['count'],
               'new_paid_requests': validation['new_paid_requests'],
               'validation_errors': validation['errors'],
               'individual_review_candidates': technical['eligible_for_individual_review'],
               'secondary_mailbox_review': technical['secondary_mailbox_review']}
        completed.append(row)
        state = {'at': datetime.now(timezone.utc).isoformat(), 'completed': completed,
                 'totals': {key: sum(x[key] for x in completed) for key in
                            ('selected', 'new_paid_requests', 'validation_errors',
                             'individual_review_candidates', 'secondary_mailbox_review')},
                 'campaign_ready': 0, 'sent': 0}
        progress.write_text(json.dumps(state, indent=2))
        print(json.dumps(row), flush=True)


if __name__ == '__main__':
    main()
