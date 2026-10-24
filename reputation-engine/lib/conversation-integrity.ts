import type { CRMLead } from './types'
import { customerLocalDate } from './sales-automation-context'

export type ConversationSignal = {
  kind?: 'declined' | 'date_unconfirmed' | 'no_active_move'
  evidence: string
  callback?: { notBefore: string; dueAt: string; customerWillReply: boolean; requestedDay: string }
}

function dayPlus(day: string, days: number) {
  return new Date(Date.parse(day + 'T12:00:00Z') + days * 86_400_000).toISOString().slice(0, 10)
}

/** Convert a Toronto wall-clock time without assuming a fixed UTC offset across DST. */
export function torontoTime(day: string, hour: number) {
  const desired = Date.parse(`${day}T${String(hour).padStart(2, '0')}:00:00Z`)
  let instant = desired
  for (let pass = 0; pass < 3; pass++) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(instant)).map(p => [p.type, p.value]))
    const rendered = Date.parse(`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:00Z`)
    instant += desired - rendered
  }
  return new Date(instant).toISOString()
}

export function extractConversationSignal(message: string, receivedAt: string, channel: 'sms' | 'call' = 'sms'): ConversationSignal {
  const text = message.replace(/\[Voicemail\]/gi, '').replace(/\s+/g, ' ').trim()
  const signal: ConversationSignal = { evidence: text.slice(0, 600) }
  if (/\b(?:decided not to (?:go|proceed)|not (?:going|go) (?:ahead|with (?:that|the|your) price)|found (?:another |a )?friend.{0,50}(?:help|move)|(?:booked|went) (?:with )?(?:another|someone else)|no longer (?:need|moving)|cancel (?:my|our|the) move)\b/i.test(text)) signal.kind = 'declined'
  else if (/\b(?:no current move(?: date)?|no (?:active|upcoming) move|didn'?t pan out|keep you in mind for future)\b/i.test(text)) signal.kind = 'no_active_move'
  else if (/\b(?:not (?:yet )?sure (?:what|which) day|(?:move|moving) date.{0,25}(?:unknown|not (?:yet )?(?:known|confirmed)|undecided)|once (?:the )?unit is ready|when (?:the )?unit is ready|get back.{0,35}(?:confirmed|what|which).{0,15}(?:date|day))\b/i.test(text)) signal.kind = 'date_unconfirmed'

  // A date in a callback commitment belongs to the callback, never the move date.
  const callback = text.match(/\b(?:(i(?:'ll| will) (?:get back|contact|call|reply)(?: to)?(?: you)?|(?:can|could|please) (?:you )?(?:phone|call|contact)(?: me| us)?(?: back)?|call (?:you|me|us) back|(?:phone|call) (?:me|us)(?: back)?)\s+(?:on\s+)?)(now|tomorrow|today|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i)
  if (callback) {
    const label = callback[2].toLowerCase(), today = customerLocalDate(receivedAt)
    let day = today
    if (label === 'tomorrow') day = dayPlus(today, 1)
    else if (label !== 'today' && label !== 'now') {
      const weekdays = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
      const delta = (weekdays.indexOf(label) - new Date(today + 'T12:00:00Z').getUTCDay() + 7) % 7
      day = dayPlus(today, delta)
    }
    const customerWillReply = channel === 'sms' && Boolean(callback[1])
    signal.callback = { notBefore: torontoTime(day, customerWillReply ? 17 : 8), dueAt: torontoTime(day, 17), customerWillReply, requestedDay: day }
    if (label === 'now') signal.callback = { ...signal.callback, notBefore: receivedAt, dueAt: new Date(Date.parse(receivedAt) + 15 * 60_000).toISOString() }
  }
  return signal
}

export function hasConversationSignal(signal: ConversationSignal) { return Boolean(signal.kind || signal.callback) }

export function isVoicemailTranscript(transcript?: string | null, recordingSource?: string | null) {
  if (recordingSource === 'RecordVerb') return true
  const text = (transcript || '').replace(/^\[Voicemail\]\s*/i, '').trim()
  if (!text) return false
  const screened = /record your name and reason for calling/i.test(text)
  if (screened && /(?:hello[, .]+[\w '-]+speaking|hello[, .]+(?:hi|hey)|(?:hi|hello)[, .]+(?:this is|i(?:'m| am)))/i.test(text.split(/please stay on the line/i).slice(1).join(' '))) return false
  if (screened) return true
  return /(?:you(?:'ve| have) reached|after the (?:tone|beep)|mailbox is full|voicemail box|please (?:leave|record) (?:a |your )?message|if you (?:would like|want) to leave (?:an? |additional )?message)/i.test(text)
    || (/\b(?:not available|unable to (?:take|answer) your call)\b/i.test(text) && !/\b(?:what is your|how (?:much|can)|thank you for (?:the|your) quote)\b/i.test(text))
}

export function callbackHold(lead: CRMLead, now = new Date()) {
  const hold = lead.callbackCommitment
  return hold?.status === 'open' && Date.parse(hold.notBefore) > now.getTime() ? hold : null
}

export function salesQualificationBlocked(lead: CRMLead) {
  return lead.conversationReview?.status === 'open' || lead.callbackCommitment?.status === 'open' || lead.deliveryFailureReview?.status === 'open'
}

export function smsDeliveryLabel(status?: string | null) {
  if (['failed', 'undelivered', 'delivery_failed', 'sending_failed'].includes(status || '')) return 'Not delivered — call or check the number'
  if (status === 'delivered') return 'Delivered'
  if (status === 'sent') return 'Sent · awaiting delivery confirmation'
  return 'Submitted · delivery unconfirmed'
}
