export const CARD_REGIONS = ['windsor', 'london', 'chatham', 'kitchener', 'waterloo', 'guelph', 'ottawa'] as const
export type CardRegion = typeof CARD_REGIONS[number]
export function cardFilename(region: string) {
  if (!(CARD_REGIONS as readonly string[]).includes(region)) throw new Error('Unknown regional card')
  return `${region === 'ottawa' ? 'Dexa_Movers' : 'Saturn_Star_Movers'}_${region}_business_card.pdf`
}
export type FulfilmentStatus = 'draft' | 'waiting' | 'sending' | 'sent' | 'completed_elsewhere'
export interface EmailTask {
  kind: 'partner_email_fulfilment'
  revision: number
  status: FulfilmentStatus
  to: string
  subject: string
  body: string
  brand: 'ssm' | 'dexa'
  region: string
  note: string
  nextReview: string
  evidence?: string
  providerId?: string
  sentAt?: string
  attachments?: { filename: string; content: string }[]
}
export function validateEmailTask(task: EmailTask, sending = false) {
  if (!['ssm', 'dexa'].includes(task.brand)) throw new Error('Choose a valid brand')
  if (task.region) {
    cardFilename(task.region)
    if ((task.region === 'ottawa') !== (task.brand === 'dexa')) throw new Error('Card must match the company brand')
  }
  if (task.subject.length > 250 || task.body.length > 20000 || task.note.length > 4000) throw new Error('Message is too long')
  const attachments = task.attachments || []
  if (attachments.length > 3) throw new Error('Use at most three additional documents')
  let bytes = 0
  for (const a of attachments) {
    if (!/^[\w .()-]+\.pdf$/i.test(a.filename) || a.filename.length > 150) throw new Error('Use a simple PDF filename')
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(a.content) || !a.content.startsWith('JVBERi0')) throw new Error('Attachment must be a PDF')
    bytes += a.content.length
  }
  if (bytes > 2800000) throw new Error('Additional PDFs must total less than 2 MB')
  if (sending) {
    if (!/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(task.to)) throw new Error('Enter one valid recipient email')
    if (!task.subject.trim() || !task.body.trim()) throw new Error('Subject and message are required')
    if (/\[[^\]\n]+\]/.test(task.body)) throw new Error('Replace the bracketed placeholders before sending')
    if (/attach/i.test(task.body) && !task.region && !attachments.length) throw new Error('Choose the attachment mentioned in your message')
  }
}
