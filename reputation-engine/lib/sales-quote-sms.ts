import { compactCustomerLink } from './customer-links'

export function buildManualQuoteSmsDraft(input: {
  firstName: string
  quoteNumber: string
  acceptUrl: string
  isRevision?: boolean
  commercial?: boolean
}) {
  const firstName = input.firstName || 'there'
  const acceptUrl = compactCustomerLink(input.acceptUrl)
  if (input.commercial) {
    return input.isRevision
      ? `Hi ${firstName}, your updated commercial estimate is ready.\n\nPlease review the full estimate here:\n${acceptUrl}\n\nThe pricing and payment terms are included.`
      : `Hi ${firstName}, your commercial estimate is ready.\n\nPlease review the full estimate here:\n${acceptUrl}\n\nApprove it when you’re ready.`
  }

  return input.isRevision
    ? `Hi ${firstName}, your updated Saturn Star estimate is ready.\n\nPlease review the full estimate here:\n${acceptUrl}\n\nThe latest changes are included.`
    : `Hi ${firstName}, your Saturn Star estimate is ready.\n\nPlease review the full estimate here:\n${acceptUrl}`
}

export function buildAutomationQuoteSmsSummary(input: {
  firstName: string
  routeLine: string
  crewLine: string
  acceptUrl: string
}) {
  const acceptUrl = compactCustomerLink(input.acceptUrl)
  return [
    `Hi ${input.firstName || 'there'}, your Saturn Star moving estimate is ready.`,
    '',
    'Please review the full estimate here:',
    acceptUrl,
    '',
    'Please review it when you’re ready. Text us here with any questions.',
  ].join('\n')
}
