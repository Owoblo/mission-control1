import type { CallLogEntry } from '@/lib/types'

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
  aiSummary?: CallLogEntry['aiSummary']
  duration?: string
  phone?: string
}
