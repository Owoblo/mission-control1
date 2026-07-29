type DepositConfirmationSmsInput = {
  customerName?: string | null
  brandName: string
  amount: number
  receiptUrl?: string | null
}

function money(value: number) {
  return new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency: 'CAD',
  }).format(Math.max(0, Number(value || 0)))
}

export function buildDepositConfirmationSms(input: DepositConfirmationSmsInput) {
  const firstName = String(input.customerName || '').trim().split(/\s+/)[0] || 'there'
  return [
    `Hi ${firstName}, we've received your ${money(input.amount)} deposit - thank you.`,
    `Your move is confirmed, and the ${input.brandName} team is looking forward to making moving day smooth and well taken care of.`,
    input.receiptUrl ? `Your receipt: ${input.receiptUrl}` : '',
  ].filter(Boolean).join(' ')
}
