import { classifyEmailIntent } from './partnership-email-intent'
export type { PartnershipEmailIntent, PartnershipEmailIntentMetadata } from './partnership-email-intent'

/** Mailbox events are distinct from human replies and provider delivery events. */
export type PartnershipEmailKind = 'reply' | 'handoff' | 'verification' | 'verification_pending_review' | 'automatic_reply' | 'opt_out' | 'delivery_failure'

export function emailText(html: string) {
  return html.replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<(?:br\s*\/?|\/p|\/div|\/tr)>/gi, '\n').replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&amp;/gi, '&')
    .replace(/&#39;|&apos;/gi, "'").replace(/&quot;/gi, '"').replace(/[ \t]+/g, ' ').replace(/\n\s*\n\s*\n/g, '\n\n').trim()
}

export function currentEmailReply(body: string) {
  return body.split(/\n\s*(?:From:|On .{8,160} wrote:|[-_—–\s]*ORIGINAL INQUIRY BELOW|[-_]{5,}|>)/i)[0].trim()
}

export function classifyPartnershipEmail(subject: string, body: string): PartnershipEmailKind {
  const text = subject + '\n' + currentEmailReply(body)
  // A signature does not qualify an otherwise explicit opt-out. Only remove
  // recognized signature boundaries; keep substantive objections for review.
  const explicitReply = currentEmailReply(body).replace(/\n\s*(?:--\s*\n|(?:best(?: regards)?|kind regards|regards|sincerely)[,!]?\s*\n|sent from my [^\n]*(?:\n|$))[\s\S]*$/i, '').trim()
  if (/verification was received|added to.{0,100}review inbox|white listed pending/i.test(text)) return 'verification_pending_review'
  if (/requires? (?:that you )?verif|verify#|sender.verification|white.?list|verify that you are a real/i.test(text)) return 'verification'
  if (/undeliverable|delivery (?:status notification|failure)|mail delivery failed|recipient not found/i.test(subject)) return 'delivery_failure'
  if (/^no\s+(?:thanks|thank\s+you)[.!\s]*$/i.test(explicitReply)) return 'opt_out'
  // Honour the explicit reply phrase offered in partnership copy. Keep this
  // anchored so a qualified objection ("not interested in X, but Y") is reviewed.
  if (/^(?:(?:no\s+thanks|thanks|thank\s+you)[,.!\s]+)?not\s+interested[.!\s]*(?:(?:thanks|thank\s+you)[.!\s]*)?$/i.test(explicitReply)) return 'opt_out'
  if (/\b(?:remove me|unsubscribe me|stop (?:emailing|contacting|sending)|do not (?:email|contact)|don't (?:email|contact))\b/i.test(currentEmailReply(body))) return 'opt_out'
  if (/automatic (?:reply|response)|auto.?reply|out of (?:the )?office|away from (?:the )?office/i.test(text)) return 'automatic_reply'
  if (/reach out to|contact (?:our|the)|speak (?:with|to)|forward(?:ed|ing).{0,50}(?:to|team)|right (?:person|department)/i.test(currentEmailReply(body))) return 'handoff'
  return 'reply'
}

export function partnershipEmailAction(kind: PartnershipEmailKind) {
  return {
    reply: 'Read the reply and respond in the existing thread.',
    handoff: 'Verify the referred person or department, link the new contact to this company, and introduce us with the referral context.',
    verification_pending_review: 'Verification was received. Await the recipient’s manual review; no further confirmation is needed.',
    verification: 'Review the sender-verification request and complete the permitted confirmation. Await recipient review; do not count as a human response.',
    automatic_reply: 'Review the return date or alternate contact and schedule the next action. Do not count as a human response.',
    opt_out: 'Stop outreach and retain the suppression.',
    delivery_failure: 'Hold this address and research a replacement; do not retry it.',
  }[kind]
}

/** Additive metadata; callers must still apply the existing kind/suppression rules. */
export function analyzePartnershipEmailReply(subject: string, body: string) {
  const kind = classifyPartnershipEmail(subject, body)
  return { kind, ...classifyEmailIntent(kind, currentEmailReply(body)) }
}

export function extractEmailReferralContacts(body: string) {
  const text=currentEmailReply(body), contacts:Array<{name:string;phone:string;context:string;urgentOnly:boolean}>=[]
  const pattern=/\b(?:call|contact)\s+([A-Z][a-z]+(?:[ '-][A-Z][a-z]+){1,3})\s+(?:immediately\s+)?(?:at|on)\s+((?:\+?1[ .-]?)?\(?\d{3}\)?[ .-]?\d{3}[ .-]?\d{4})/g
  for(const m of text.matchAll(pattern)){
    const digits=m[2].replace(/\D/g,'');if(digits.length!==10&&!(digits.length===11&&digits.startsWith('1')))continue
    const phone='+'+(digits.length===10?'1':'')+digits
    if(contacts.some(c=>c.phone===phone))continue
    const context=text.slice(Math.max(0,(m.index||0)-100),(m.index||0)+m[0].length+60)
    contacts.push({name:m[1],phone,context,urgentOnly:/urgent|emergency/i.test(context)})
    if(contacts.length===5)break
  }
  return contacts
}
