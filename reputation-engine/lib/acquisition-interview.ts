export const DISCOVERY_CHANNELS = ['postcard', 'connector', 'search', 'social', 'existing_customer', 'other', 'unknown'] as const
export const POSTCARD_ROUTES = ['home_mail', 'work_mail', 'handed_by_connector', 'building_display', 'forwarded_digitally', 'other', 'unknown'] as const
export type AcquisitionInterview = {
  status: 'answered' | 'does_not_recall' | 'declined'
  channel: typeof DISCOVERY_CHANNELS[number]
  customerWords: string
  postcardRoute: typeof POSTCARD_ROUTES[number]
  postcardLocation: string
  postcardCode: string
  connectorId: string
  connectorName: string
  connectorCompany: string
  connectorRole: 'referred_customer' | 'passed_card' | 'assisted' | 'unknown'
  recordedAt: string
  recordedBy: string
  revision: number
}
export type AcquisitionInterviewDraft = Omit<AcquisitionInterview, 'connectorName' | 'connectorCompany' | 'recordedAt' | 'recordedBy' | 'revision'>

export function validateAcquisitionInterview(value: unknown): AcquisitionInterviewDraft {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Source details are required.')
  const data = value as Record<string, unknown>
  const text = (key: string, limit: number) => {
    if (data[key] === undefined) return ''
    if (typeof data[key] !== 'string' || data[key].length > limit) throw new Error(`Invalid ${key}.`)
    return data[key].trim()
  }
  const status = data.status
  if (!['answered', 'does_not_recall', 'declined'].includes(String(status))) throw new Error('Record whether the customer answered, cannot recall, or declined.')
  const channel = data.channel
  const postcardRoute = data.postcardRoute
  const connectorRole = data.connectorRole
  if (!DISCOVERY_CHANNELS.includes(channel as never)) throw new Error('Select how the customer heard about us.')
  if (!POSTCARD_ROUTES.includes(postcardRoute as never)) throw new Error('Select how the postcard reached them.')
  if (!['referred_customer', 'passed_card', 'assisted', 'unknown'].includes(String(connectorRole))) throw new Error('Invalid connector role.')
  const draft = { status, channel, postcardRoute, connectorRole, customerWords: text('customerWords', 2000),
    postcardLocation: text('postcardLocation', 300), postcardCode: text('postcardCode', 120), connectorId: text('connectorId', 80) } as AcquisitionInterviewDraft
  if (draft.connectorId && !/^[a-zA-Z0-9_-]+$/.test(draft.connectorId)) throw new Error('Invalid connector.')
  if (draft.status !== 'answered') {
    // An explicit non-answer does not create guessed attribution.
    return { ...draft, channel: 'unknown', postcardRoute: 'unknown', postcardLocation: '', postcardCode: '', connectorId: '', connectorRole: 'unknown' }
  }
  if (draft.channel === 'unknown' && !draft.customerWords && !draft.connectorId && draft.postcardRoute === 'unknown') throw new Error('Add the customer’s answer or select “Does not recall”.')
  return draft
}

export function interviewNeedsFollowUp(interview?: AcquisitionInterview | null) {
  return !interview
}
