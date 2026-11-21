// Pure reporting logic: no transport or database writes.
export function summarizeMailEvidence({requests, attempts, receipts, replies, contacts, now}) {
  const requestById = new Map(requests.map(r => [r.id, r]));
  const contactById = new Map(contacts.map(c => [c.id, c]));
  const attemptById = new Map(attempts.map(a => [a.id, a]));
  const groups = new Map();
  const key = (id, recipient) => JSON.stringify([id, recipient.trim().toLowerCase()]);
  function add(id, recipient, attempt) {
    const k = key(id, recipient);
    if (!groups.has(k)) groups.set(k, {attempt, events:new Set()});
    const group=groups.get(k);
    if (!group.attempt && attempt) group.attempt=attempt;
    return group;
  }
  for (const a of attempts) {
    const r=requestById.get(a.request_id);
    if (a.state==='accepted' && a.provider_message_id && r) {
      for (const recipient of r.recipients) add(a.provider_message_id,recipient,a).events.add('accepted');
    }
  }
  for (const r of receipts) add(r.provider_message_id,r.recipient,attemptById.get(r.attempt_id)).events.add(r.event_type);
  const messages={outreach:0,internal:0,transactional:0,unattributed:0,delivered:0,bounced:0,complained:0,rejected:0};
  for (const g of groups.values()) {
    const r=requestById.get(g.attempt?.request_id);
    const contact=contactById.get(r?.context?.contactId);
    const purpose=contact?.tags?.includes('internal-infrastructure-test')?'internal':r?.purpose;
    messages[['outreach','internal','transactional'].includes(purpose)?purpose:'unattributed']++;
    for (const state of ['delivered','bounced','complained','rejected']) if (g.events.has('email_'+state)) messages[state]++;
  }
  const incoming={humanMessages:0,humanContacts:0,automatic:0,optOuts:0,spamRecovered:0,internalTestMessages:0,unclassified:0};
  const people=new Set(), seen=new Set();
  for (const r of replies) {
    const m=r.metadata||{};
    const id=m.zoho_message_id?JSON.stringify([m.zoho_account_id,m.zoho_message_id]):r.id;
    if (seen.has(id)) continue;
    seen.add(id);
    const contact=contactById.get(r.contact_id);
    if (!contact) {incoming.unclassified++;continue;}
    if (contact.tags?.includes('internal-infrastructure-test')) {incoming.internalTestMessages++;continue;}
    if (m.found_in_spam===true) incoming.spamRecovered++;
    if (m.email_kind==='opt_out') incoming.optOuts++;
    else if (m.email_kind==='automatic_reply') incoming.automatic++;
    else if (m.human_reply===true) {incoming.humanMessages++;people.add(r.contact_id);}
    else incoming.unclassified++;
  }
  incoming.humanContacts=people.size;
  const unresolved=attempts.filter(a=>a.state==='unknown'||(['prepared','dispatching'].includes(a.state)&&Date.parse(a.created_at)<Date.parse(now)-300000));
  return {messages,incoming,unresolvedAttemptsInWindow:unresolved.map(a=>({id:a.id,state:a.state,providerMessageId:a.provider_message_id||null})),
    humanReplyRate:null,positiveReplyRate:null,bookings:null,revenue:null,
    metricLimitations:['Receipt counts are distinct provider-message/recipient pairs; events may overlap (a delivery can later bounce).',
      'Unattributed receipts can include warm-up and older sending paths; they are not counted as outreach.',
      'Replies are period activity, not a first-contact cohort. Reply and positive rates remain unavailable until cohort attribution is verified.',
      'Automated intent labels are not reviewed positive outcomes. Booking and revenue attribution are not connected.']};
}
