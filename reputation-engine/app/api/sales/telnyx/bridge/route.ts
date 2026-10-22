import { authorizeTwilioWebhook } from '@/lib/server/security'
import { carrierVoiceForm } from '@/lib/server/carrier-voice'
import { GTA_PARTNERSHIP_NUMBER, GTA_SALES_NUMBER } from '@/lib/telephony-providers'
import { POST as salesVoice } from '@/app/api/sales/dialer/twiml/route'
import { POST as partnershipVoice } from '@/app/api/marketing/dialer/twiml/route'

export async function POST(request: Request) {
  const raw = await request.clone().text()
  const rejection = await authorizeTwilioWebhook(request, raw)
  if (rejection) return rejection
  const form = carrierVoiceForm(raw)
  if (form.get('Carrier') !== 'telnyx') return new Response('Unknown carrier ingress', { status: 403 })
  if (form.get('To') === GTA_PARTNERSHIP_NUMBER) return partnershipVoice(request)
  if (form.get('To') === GTA_SALES_NUMBER) return salesVoice(request)
  return new Response('Unknown company line', { status: 400 })
}
