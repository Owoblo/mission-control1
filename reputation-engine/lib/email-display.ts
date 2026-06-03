const RESEND_SUBJECT_PREFIX = /^\s*\[resend:[^\]]+\]\s*/i

export function displayEmailSubject(subject?: string | null) {
  const cleaned = (subject || '').replace(RESEND_SUBJECT_PREFIX, '').trim()
  return cleaned || '(no subject)'
}

export function replyEmailSubject(subject?: string | null) {
  const cleaned = displayEmailSubject(subject).replace(/^Re:\s*/i, '').trim()
  return `Re: ${cleaned || '(no subject)'}`
}
