import type { SessionPayload } from '@/lib/auth'
import { getSalesBranchFromSaturnPhone, normalizePhone } from '@/lib/sales-phones'
import { isTwilioCallSid, resolveTwilioCallLegs, type TwilioCallLeg } from '@/lib/twilio-call-control'
import { getTwilioCredentials } from './runtime'
import { twilioAuth } from './twilio-recordings'

export function assertOwnedLiveLeg(legs: TwilioCallLeg[], session: SessionPayload) {
  const address = `client:saturn-rep-${session.userId}`
  if (!session.userId || !legs.some(leg => leg.status === 'in-progress' && [leg.from, leg.to].includes(address))) {
    throw new Error('This active call does not belong to your signed-in dialer.')
  }
}
export async function readTwilioCall(path: string) {
  const { accountSid, authToken } = getTwilioCredentials()
  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}${path}`, { headers: { Authorization: twilioAuth(accountSid, authToken) }, cache: 'no-store', signal: AbortSignal.timeout(10000) })
  if (!response.ok) throw new Error('The active call could not be verified.')
  return response.json()
}
export async function verifyOwnedActiveCall(callSid: string, session: SessionPayload, expectedPhone?: string) {
  if (!isTwilioCallSid(callSid)) throw new Error('Invalid active Call SID')
  const active = await readTwilioCall(`/Calls/${callSid}.json`) as TwilioCallLeg
  const related: TwilioCallLeg[] = active.parent_call_sid
    ? [await readTwilioCall(`/Calls/${active.parent_call_sid}.json`) as TwilioCallLeg]
    : ((await readTwilioCall(`/Calls.json?ParentCallSid=${callSid}&PageSize=20`)).calls || [])
  assertOwnedLiveLeg([active, ...related], session)
  const resolved = resolveTwilioCallLegs(active, related)
  const customer = [active, ...related].find(leg => leg.sid === resolved.customerCallSid)
  if (!customer || customer.status !== 'in-progress') throw new Error('The customer call is no longer active.')
  if (expectedPhone && ![customer.from, customer.to].some(value => normalizePhone(value) === normalizePhone(expectedPhone))) throw new Error('The customer phone does not match the active call.')
  const branch = [customer.from, customer.to, active.from, active.to].map(value => getSalesBranchFromSaturnPhone(value)).find(Boolean)
  if (session.branch && branch !== session.branch) throw new Error('This call is outside your branch.')
  return { ...resolved, branch }
}
