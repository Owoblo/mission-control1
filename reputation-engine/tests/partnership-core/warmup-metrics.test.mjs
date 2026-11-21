import assert from 'node:assert/strict';
import test from 'node:test';
import { summarizeWarmupEvents } from '../../lib/partnership-core/warmup-metrics.mjs';

const at = '2026-10-28T12:00:00.000Z';
const sent = (id, cohort, recipient, provider = 'gmail') => ({ id: `send:${id}`, testId: id, type: 'sent', at, cohort, recipient, recipientProvider: provider, senderPath: 'ses' });
const event = (id, type, detail, time = '2026-10-28T12:01:00.000Z') => ({ id: `${type}:${id}:${time}`, testId: id, type, at: time, ...detail });

test('keeps first placement and separates human from automated replies', () => {
  const events = [
    sent('a', 'untouched_seed', 'seed@gmail.com'),
    event('a', 'placement', { placement: 'spam' }),
    event('a', 'moved', {}, '2026-10-28T12:02:00.000Z'),
    sent('b', 'consenting_exchange', 'friend@outlook.com', 'outlook'),
    event('b', 'placement', { placement: 'primary' }),
    event('b', 'reply', { replyKind: 'human' }, '2026-10-28T12:03:00.000Z'),
    sent('c', 'consenting_exchange', 'friend2@gmail.com'),
    event('c', 'placement', { placement: 'other_inbox' }),
    event('c', 'reply', { replyKind: 'automated' }, '2026-10-28T12:04:00.000Z'),
  ];
  const report = summarizeWarmupEvents([...events, events[0]], { now: '2026-10-29T00:00:00.000Z' });
  assert.equal(report.totals.sent, 3);
  assert.equal(report.totals.spam, 1);
  assert.equal(report.totals.movedAfterObservation, 1);
  assert.equal(report.totals.humanReplies, 1);
  assert.equal(report.totals.automatedReplies, 1);
  assert.equal(report.totals.initialInboxRate, 2 / 3);
  assert.equal(report.byProvider.gmail.sent, 2);
  assert.equal(report.diagnostics.untouchedSeedInteracted, 1);
});

test('does not turn a post-move observation into an initial inbox placement', () => {
  const report = summarizeWarmupEvents([
    sent('a', 'untouched_seed', 'seed@gmail.com'),
    event('a', 'moved', {}),
    event('a', 'placement', { placement: 'primary' }, '2026-10-28T12:02:00.000Z'),
  ], { now: '2026-10-29T00:00:00.000Z' });
  assert.equal(report.totals.primary, 0);
  assert.equal(report.totals.unobserved, 1);
  assert.equal(report.diagnostics.placementAfterMove, 1);
});
