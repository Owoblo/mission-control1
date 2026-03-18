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
  transcript?: string
  aiSummary?: AISummary
  duration?: string
  phone?: string
  isVoicemail?: boolean
}
