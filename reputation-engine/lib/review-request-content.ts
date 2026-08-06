export type ReviewRequestCopy = {
  smsBody: string
  emailSubject: string
  emailBody: string
}

export function buildReviewRequestCopy(input: {
  firstName: string
  brandName: string
  reviewFlowUrl: string
}) : ReviewRequestCopy {
  const firstName = input.firstName || 'there'
  const brandName = input.brandName || 'Saturn Star Movers'
  const request = `If you have a minute, would you mind sharing a few words about your experience? Your review means a lot to our crew and helps a local small business continue to grow.`
  return {
    smsBody: `Hi ${firstName}! Thank you again for trusting ${brandName} with your move. We hope the team took great care of you.\n\n${request}\n\n${input.reviewFlowUrl}\n\nThank you — the ${brandName} team 🌟`,
    emailSubject: `A small favour from ${brandName} 🌟`,
    emailBody: `Hi ${firstName},\n\nThank you again for trusting ${brandName} with your move. We hope the team took great care of you.\n\n${request}\n\nShare your experience here: ${input.reviewFlowUrl}\n\nWith gratitude,\nThe ${brandName} team`,
  }
}
