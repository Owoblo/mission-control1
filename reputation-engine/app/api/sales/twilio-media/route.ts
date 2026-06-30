import { maxDuration, proxyTwilioMedia } from '@/lib/server/twilio-media-proxy'

export { maxDuration }

export async function GET(request: Request) {
  return proxyTwilioMedia(request)
}
