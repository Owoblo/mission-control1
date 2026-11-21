const types = new Set(['sent', 'delivered', 'placement', 'reply', 'moved']);
const cohorts = new Set(['untouched_seed', 'consenting_exchange', 'real_business']);
const placements = new Set(['primary', 'other_inbox', 'spam', 'missing']);
const replyKinds = new Set(['human', 'automated']);

function validTime(value) {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) throw new Error('Event requires a valid at timestamp');
  return time;
}

export function summarizeWarmupEvents(input, { now = new Date(), days = 7 } = {}) {
  if (!Array.isArray(input) || !Number.isInteger(days) || days < 1) throw new Error('Invalid events or window');
  const end = validTime(now instanceof Date ? now.toISOString() : now);
  const start = end - days * 86400000;
  const ids = new Map();
  for (const event of input) {
    if (!event || !event.id || !event.testId || !types.has(event.type)) throw new Error('Invalid warmup event');
    validTime(event.at);
    if (event.type === 'sent' && (!cohorts.has(event.cohort) || !event.recipient || !event.recipientProvider || !event.senderPath)) throw new Error('Sent event requires cohort, recipient, provider and sender path');
    if (event.type === 'placement' && !placements.has(event.placement)) throw new Error('Invalid placement');
    if (event.type === 'reply' && !replyKinds.has(event.replyKind)) throw new Error('Invalid reply kind');
    const previous = ids.get(event.id);
    if (previous && JSON.stringify(previous) !== JSON.stringify(event)) throw new Error('Conflicting event ID');
    ids.set(event.id, event);
  }
  const groups = new Map();
  for (const event of [...ids.values()].sort((a, b) => validTime(a.at) - validTime(b.at) || String(a.id).localeCompare(String(b.id)))) {
    const group = groups.get(event.testId) || { events: [], sent: null };
    if (event.type === 'sent') {
      if (group.sent && JSON.stringify(group.sent) !== JSON.stringify(event)) throw new Error('Conflicting send for testId');
      group.sent = event;
    }
    group.events.push(event);
    groups.set(event.testId, group);
  }
  const empty = () => ({ sent: 0, delivered: 0, primary: 0, otherInbox: 0, spam: 0, missing: 0, unobserved: 0, movedAfterObservation: 0, humanReplies: 0, automatedReplies: 0, uniqueRecipients: 0, initialInboxRate: null, humanReplyRate: null });
  const result = { windowStart: new Date(start).toISOString(), windowEnd: new Date(end).toISOString(), byCohort: {}, byProvider: {}, bySenderPath: {}, totals: empty(), diagnostics: { orphanEvents: 0, placementAfterMove: 0, untouchedSeedInteracted: 0 } };
  const recipientSets = new Map();
  const add = (key, bucket, data) => {
    const row = bucket[key] || (bucket[key] = empty());
    row.sent += 1;
    if (data.delivered) row.delivered += 1;
    if (data.placement === 'primary') row.primary += 1;
    else if (data.placement === 'other_inbox') row.otherInbox += 1;
    else if (data.placement === 'spam') row.spam += 1;
    else if (data.placement === 'missing') row.missing += 1;
    else row.unobserved += 1;
    if (data.movedAfterObservation) row.movedAfterObservation += 1;
    if (data.humanReply) row.humanReplies += 1;
    if (data.automatedReply) row.automatedReplies += 1;
    const setKey = bucket === result.byCohort ? `cohort:${key}` : bucket === result.byProvider ? `provider:${key}` : bucket === result.bySenderPath ? `path:${key}` : 'total';
    const recipients = recipientSets.get(setKey) || new Set();
    recipients.add(data.recipient.toLowerCase());
    recipientSets.set(setKey, recipients);
    row.uniqueRecipients = recipients.size;
  };
  for (const group of groups.values()) {
    if (!group.sent) { result.diagnostics.orphanEvents += group.events.length; continue; }
    const sentAt = validTime(group.sent.at);
    if (sentAt < start || sentAt > end) continue;
    const later = group.events.filter(event => validTime(event.at) >= sentAt && validTime(event.at) <= end);
    const firstMove = later.find(event => event.type === 'moved');
    const firstPlacement = later.find(event => event.type === 'placement');
    const placementAfterMove = !!firstPlacement && !!firstMove && validTime(firstPlacement.at) >= validTime(firstMove.at);
    if (placementAfterMove) result.diagnostics.placementAfterMove += 1;
    const placement = placementAfterMove ? null : firstPlacement?.placement || null;
    const movedAfterObservation = !!firstMove && !!firstPlacement && validTime(firstMove.at) > validTime(firstPlacement.at);
    const humanReply = later.some(event => event.type === 'reply' && event.replyKind === 'human');
    const automatedReply = later.some(event => event.type === 'reply' && event.replyKind === 'automated');
    if (group.sent.cohort === 'untouched_seed' && (humanReply || automatedReply || firstMove)) result.diagnostics.untouchedSeedInteracted += 1;
    const data = { delivered: later.some(event => event.type === 'delivered'), placement, movedAfterObservation, humanReply, automatedReply, recipient: group.sent.recipient };
    add(group.sent.cohort, result.byCohort, data);
    add(group.sent.recipientProvider.toLowerCase(), result.byProvider, data);
    add(group.sent.senderPath.toLowerCase(), result.bySenderPath, data);
    add('all', { all: result.totals }, data);
  }
  for (const bucket of [result.byCohort, result.byProvider, result.bySenderPath, { all: result.totals }]) {
    for (const row of Object.values(bucket)) {
      row.initialInboxRate = row.sent ? (row.primary + row.otherInbox) / row.sent : null;
      row.humanReplyRate = row.sent ? row.humanReplies / row.sent : null;
    }
  }
  return result;
}
