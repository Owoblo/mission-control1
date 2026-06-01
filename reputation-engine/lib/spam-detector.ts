import type { CRMLead } from './types'

const SPAM_PHRASES = [
  'seo', 'search engine optimization', 'google ranking', 'boost your ranking',
  'digital marketing', 'social media marketing', 'email marketing',
  'web design', 'website design', 'online presence', 'found your website',
  'we can help you rank', 'lead generation', 'increase your traffic',
  'marketing agency', 'advertising agency', 'ppc campaign', 'google ads management',
  'we help businesses', 'grow your business online', 'reputation management',
  'i represent', 'on behalf of our agency',
]

// Names/emails that strongly suggest vendor spam rather than a real move lead
const SPAM_NAME_PATTERNS = [
  /\b(agency|seo|digital|media|marketing|solutions llc|solutions inc)\b/i,
]

const SPAM_EMAIL_PATTERNS = [
  /@(mailinator|tempmail|guerrillamail|yopmail|throwam|sharklasers)\./i,
]

export interface SpamSignal {
  isSpam: boolean
  reason?: string
}

export function detectSpamLead(lead: CRMLead): SpamSignal {
  const textToCheck = [
    lead.notes,
    lead.moveReason,
    lead.customerPriority,
  ].filter(Boolean).join(' ').toLowerCase()

  for (const phrase of SPAM_PHRASES) {
    if (textToCheck.includes(phrase)) {
      return { isSpam: true, reason: `Message contains "${phrase}"` }
    }
  }

  if (lead.name) {
    for (const pattern of SPAM_NAME_PATTERNS) {
      if (pattern.test(lead.name)) {
        return { isSpam: true, reason: `Name pattern suggests vendor: "${lead.name}"` }
      }
    }
  }

  if (lead.email) {
    for (const pattern of SPAM_EMAIL_PATTERNS) {
      if (pattern.test(lead.email)) {
        return { isSpam: true, reason: 'Disposable email address' }
      }
    }
  }

  // No move date + no address + no phone = likely junk
  const hasAddress = !!(lead.originAddress || lead.destAddress)
  const hasPhone = !!lead.phone
  const hasMoveDate = !!lead.moveDate
  if (!hasPhone && !hasAddress && !hasMoveDate) {
    return { isSpam: true, reason: 'No phone, address, or move date — likely incomplete spam submission' }
  }

  return { isSpam: false }
}
