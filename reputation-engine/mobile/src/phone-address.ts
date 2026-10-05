/** Extract a PSTN address without treating SDK client identities as phone numbers. */
export function phoneFromVoiceAddress(value?: string | null): string {
  const raw = (value || '').trim();
  if (!raw || /^client:/i.test(raw)) return '';
  let address = raw;
  if (/^sips?:/i.test(raw)) {
    const match = raw.match(/^sips?:([^@;?]+)@/i);
    if (!match) return '';
    try { address = decodeURIComponent(match[1]); } catch { return ''; }
  }
  if (!/^\+?[\d\s().-]+$/.test(address)) return '';
  const digits = address.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return address.startsWith('+') && digits.length >= 7 && digits.length <= 15 ? `+${digits}` : '';
}

export function customerPhoneForCall(direction: 'inbound' | 'outbound', from?: string | null, to?: string | null, fallback = '') {
  const addresses = direction === 'outbound' ? [fallback, to, from] : [from, fallback, to];
  return addresses.map(phoneFromVoiceAddress).find(Boolean) || fallback || '';
}
