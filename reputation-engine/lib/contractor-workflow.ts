import type { SessionPayload } from './auth'
export const ONBOARDING_STAGES = {interested:'To contact',screening:'Intro call',collecting:'Details & documents',ready:'Ready for first job',approved:'Approved regular',paused:'Paused / not a fit'} as const
export type OnboardingStage = keyof typeof ONBOARDING_STAGES
export const PROFILE_FIELDS = {
 legalBusinessName:'Legal / company name',contactName:'Main contact',contactRole:'Contact role',phone:'Business phone',email:'Email',homeMarket:'Base city',serviceAreas:'Cities and travel radius',
 phoneAnsweredBy:'Who answers the business phone?',serviceModel:'Truck and crew / driver only / labour only',specialtyDetails:'Specialty experience and limits',
 dispatchName:'Dispatcher / job-day contact',dispatchPhone:'Dispatch phone',backupContact:'Backup contact',preferredContact:'Preferred contact method',contactHours:'Contact hours',
 truckCount:'Number of trucks',truckSizes:'Truck sizes',rentalNotice:'Rental notice / availability',crewSize:'Crew capacity',simultaneousJobs:'Jobs you can cover at once',availability:'Working days and notice needed',equipment:'Equipment supplied',restrictions:'Limits / jobs not suitable',
 pricingModel:'Hourly / fixed / per job',rateNotes:'Rates by crew and truck',minimumHours:'Minimum hours',travelCharges:'Travel / fuel charges',extras:'Stairs, heavy items and other extras',cancellationTerms:'Cancellation terms',paymentTerms:'Agreed invoice and payment timing',
 shippingName:'Uniform recipient',shippingAddress:'Uniform delivery address',shirtSizes:'Shirt sizes and quantities',branding:'Uniform / branding agreement',insuranceExpiry:'Insurance expiry',questions:'Questions / follow-up notes',
} as const
export const CHECKLIST_FIELDS = {fitConfirmed:'Good fit confirmed',briefingComplete:'How Saturn works explained',termsAgreed:'Scope, extra-work approval and payment terms agreed',shippingConfirmed:'Uniform address / sizes confirmed or not needed'} as const
export type ContractorCase = {id:string;subcontractor_id:string|null;display_name:string;city:string;phone:string;email:string;interest:string;source_group:string;source_note:string;hold_reason:string;stage:OnboardingStage;assignee_id:string|null;next_action:string;follow_up_at:string|null;profile:Record<string,unknown>;checklist:Record<string,boolean>;trial_notes:string;updated_at:string;source_key?:string}
export function canReviewPayment(session?:SessionPayload|null){return session?.role==='owner'||session?.role==='manager'}
export function cleanProfile(input:unknown) {
 const source=(input && typeof input==='object' && !Array.isArray(input)?input:{}) as Record<string,unknown>
 const result:Record<string,unknown>={}
 for(const key of Object.keys(PROFILE_FIELDS))result[key]=typeof source[key]==='string'?source[key].trim().slice(0,2000):''
 result.truckAccess=Array.isArray(source.truckAccess)?source.truckAccess.filter(v=>['Own','Lease','Rent','Labour only'].includes(v)).slice(0,4):[]
 result.specialties=Array.isArray(source.specialties)?source.specialties.filter(v=>typeof v==='string').map(v=>v.slice(0,80)).slice(0,20):[]
 return result
}
export function readinessGaps(row:Pick<ContractorCase,'phone'|'hold_reason'|'profile'|'checklist'>,documentsReviewed:boolean,paymentVerified:boolean) {
 const gaps:string[]=[]
 if(row.hold_reason)gaps.push('Resolve the outreach / identity hold')
 if(!/^\+1\d{10}$/.test(row.phone))gaps.push('Confirm a contact phone')
 for(const key of ['legalBusinessName','dispatchName','dispatchPhone','serviceAreas','crewSize','pricingModel','rateNotes','paymentTerms'])if(!String(row.profile[key] || '').trim())gaps.push(PROFILE_FIELDS[key as keyof typeof PROFILE_FIELDS])
 const access=row.profile.truckAccess as string[]|undefined
 if(!access?.length)gaps.push('Confirm truck access or labour-only work')
 if(access?.some(v=>v!=='Labour only') && !row.profile.truckSizes)gaps.push('Confirm truck sizes')
 for(const [key,label] of Object.entries(CHECKLIST_FIELDS))if(!row.checklist[key])gaps.push(label)
 if(!documentsReviewed)gaps.push('Complete document review')
 if(!paymentVerified)gaps.push('Complete restricted payment verification')
 const expiry=String(row.profile.insuranceExpiry || '')
 if(!/^\d{4}-\d{2}-\d{2}$/.test(expiry)||expiry<new Date().toISOString().slice(0,10))gaps.push('Confirm current insurance expiry')
 return gaps
}
