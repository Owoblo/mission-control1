import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyHandoffDraft, mergeHandoffDraft } from '../../lib/handoff-draft';
import { generateHandoffDraft, validateDraft } from '../../lib/server/handoff-draft';
const valid = { summary: 'Own move', knownDetails: 'Three bedrooms', missingDetails: 'Bed sizes', johnContext: 'Inventory discussed', callbackPermission: 'Timing not confirmed', nextAction: 'Open existing opportunity' };
test('a late AI draft preserves edits, including deliberately cleared text', () => {
  const current = { ...emptyHandoffDraft(), summary: 'My summary' };
  const merged = mergeHandoffDraft(current, valid, new Set(['summary', 'knownDetails']));
  assert.equal(merged.summary, 'My summary');
  assert.equal(merged.knownDetails, '');
  assert.equal(merged.nextAction, valid.nextAction);
});
test('AI response must include every field within the same limits as submission', () => {
  assert.deepEqual(validateDraft(valid), valid);
  for (const value of [null, [], { ...valid, missingDetails: '' }, { ...valid, summary: 'x'.repeat(1201) }, { ...valid, knownDetails: 3 }])
    assert.throws(() => validateDraft(value));
});
test('drafting supplies direction and existing job evidence; rejects truncated responses and oversized history', async () => {
  const originalFetch = globalThis.fetch;
  const key = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'test';
  let finish = 'stop'; let calls = 0;
  globalThis.fetch = async (_url, options) => {
    calls++;
    const request = JSON.parse(String(options?.body));
    const evidence = JSON.parse(request.messages[1].content);
    assert.equal(evidence.history[0].direction, 'outbound');
    assert.equal(evidence.jobs[0].id, 'existing');
    assert.match(request.messages[0].content, /NOT customer confirmations/);
    return Response.json({ choices: [{ finish_reason: finish, message: { content: JSON.stringify(valid) } }] });
  };
  const evidence = { contact: { name: 'Alexei' }, history: [{ id: 'touch', contact_id: 'c', direction: 'outbound', channel: 'sms', created_at: '2026-10-13', notes: 'Do you have 4 stools?' }], jobs: [{ id: 'existing' }], recordings: [], sourceTouchId: '' };
  try {
    assert.deepEqual(await generateHandoffDraft(evidence), valid);
    finish = 'length';
    await assert.rejects(generateHandoffDraft(evidence), /could not complete/);
    await assert.rejects(generateHandoffDraft({ ...evidence, contact: { notes: 'x'.repeat(180001) } }), /too long/);
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
    if (key === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = key;
  }
});
