export const SPECIALTIES = ['Residential moves', 'Commercial / office moves', 'Packing', 'Furniture assembly', 'Pianos', 'Safes', 'Hot tubs', 'Pool tables', 'Commercial machinery', 'Rigging / hoisting', 'Appliances', 'Storage / warehousing', 'Long-distance moves']
export const DOCUMENT_TYPES = { registration: 'Business registration', insurance: 'Proof of insurance', identity: 'Photo ID — owner or authorized representative', additional_insured: 'Additional-insured endorsement / evidence' } as const
export type DocumentKind = keyof typeof DOCUMENT_TYPES
export const REQUIRED_DOCUMENTS: DocumentKind[] = ['registration', 'insurance', 'identity']
export const EDITABLE_STAGES = ['invited', 'screening', 'application', 'verification']
export const STAGE_LABELS: Record<string, string> = { invited: 'Invited', screening: 'Introductory call', application: 'Application in progress', verification: 'Under review', agreement: 'Agreement & standards', payout_setup: 'Payment setup', brand_training: 'Brand briefing', trial: 'Trial job', active: 'Approved', declined: 'Closed' }
export const EMPTY_APPLICATION = {
  legalBusinessName: '', contactName: '', contactRole: '', phone: '', email: '', homeMarket: '', serviceAreas: '',
  phoneAnsweredBy: '', dispatchName: '', dispatchRole: '', dispatchPhone: '', preferredContact: '', contactHours: '', backupContact: '',
  serviceModel: '', truckAccess: [] as string[], truckSizes: '', truckCount: '', rentalNotice: '', crewSize: '', availability: '',
  specialties: [] as string[], specialtyDetails: '', equipment: '', restrictions: '', pricingModel: '', rateNotes: '',
  insurer: '', insuranceExpiry: '', additionalInsured: '', branding: '', questions: '', confirmed: false,
}
export type ContractorApplication = typeof EMPTY_APPLICATION
export function parseApplication(input: unknown): ContractorApplication {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Please enter your company details.')
  const source = input as Record<string, unknown>
  const result = { ...EMPTY_APPLICATION }
  for (const key of Object.keys(EMPTY_APPLICATION) as (keyof ContractorApplication)[]) {
    if (key === 'confirmed') result.confirmed = source.confirmed === true
    else if (key === 'specialties' || key === 'truckAccess') {
      const allowed = key === 'specialties' ? SPECIALTIES : ['Own', 'Lease', 'Rent', 'Labour only']
      result[key] = Array.isArray(source[key]) ? [...new Set((source[key] as unknown[]).filter((v): v is string => typeof v === 'string' && allowed.includes(v)))] : []
    } else result[key] = typeof source[key] === 'string' ? (source[key] as string).trim().slice(0, 2000) : ''
  }
  return result
}
export function applicationErrors(a: ContractorApplication): string[] {
  const required: (keyof ContractorApplication)[] = ['legalBusinessName', 'contactName', 'contactRole', 'phone', 'email', 'homeMarket', 'serviceAreas', 'phoneAnsweredBy', 'dispatchName', 'dispatchRole', 'dispatchPhone', 'preferredContact', 'serviceModel', 'crewSize', 'pricingModel']
  const errors = required.filter(key => !a[key]).map(key => `Complete ${key.replace(/([A-Z])/g, ' $1').toLowerCase()}.`)
  if (!/^\S+@\S+\.\S+$/.test(a.email)) errors.push('Enter a valid email address.')
  for (const phone of [a.phone, a.dispatchPhone]) if (phone.replace(/\D/g, '').length < 10) errors.push('Enter a complete business and dispatch phone number.')
  if (!a.truckAccess.length) errors.push('Select how you access trucks, or labour only.')
  if (!a.specialties.length) errors.push('Select at least one service.')
  if (a.specialties.some(s => ['Hot tubs', 'Pool tables', 'Commercial machinery', 'Rigging / hoisting', 'Pianos', 'Safes'].includes(s)) && !a.specialtyDetails) errors.push('Describe your experience, equipment and limits for specialty work.')
  if (a.truckAccess.some(t => t !== 'Labour only') && !a.truckSizes) errors.push('Tell us the truck sizes you can supply.')
  if (!a.confirmed) errors.push('Confirm that the information is accurate before submitting.')
  return errors
}
export function inviteIsOpen(invite: { expires_at?: string; stage: string } | null, now = Date.now()) {
  return !!invite && EDITABLE_STAGES.includes(invite.stage) && (!invite.expires_at || Date.parse(invite.expires_at) > now)
}
export function detectDocumentType(bytes: Uint8Array): { type: string; extension: string } | null {
  if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d) return { type: 'application/pdf', extension: 'pdf' }
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { type: 'image/jpeg', extension: 'jpg' }
  if ([137,80,78,71,13,10,26,10].every((n,i) => bytes[i] === n)) return { type: 'image/png', extension: 'png' }
  return null
}

export function onboardingProgress(stage: string, submitted: boolean, documents: { kind: string }[]) {
  if (stage !== 'verification' || !submitted) return STAGE_LABELS[stage] || stage
  return Object.keys(DOCUMENT_TYPES).some(kind => !documents.some(d => d.kind === kind)) ? 'Details received · Documents pending' : 'Documents received · Review pending'
}
