import type { AISummary } from '@/lib/types'

export type TimelineItem = {
  id: string
  kind: string
  text: string
  date: string
  actor?: string
  amount?: number
  quoteId?: string
  recordingUrl?: string
  recordingSid?: string
  recordingStatus?: 'received' | 'uploaded' | 'verified' | 'transcribed' | 'failed' | 'twilio_deleted' | 'unavailable'
  recordingUnavailable?: boolean
  recordingUnavailableReason?: string
  transcript?: string
  aiSummary?: AISummary
  duration?: string
  phone?: string
  branchLabel?: string
  branchNumber?: string
  isVoicemail?: boolean
  emailSubject?: string
  callSid?: string
  repName?: string
}
