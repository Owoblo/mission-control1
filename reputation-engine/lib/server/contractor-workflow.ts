import { operationsDb } from './operations-phone'
import type { ContractorCase } from '../contractor-workflow'
export async function getContractorCase(id:string):Promise<ContractorCase|null> {
 if(!/^[a-f0-9-]{36}$/i.test(id))return null
 return (await operationsDb(`contractor_onboarding_cases?id=eq.${id}&limit=1`))[0]||null
}
export async function caseInvite(row:ContractorCase) {
 if(!row.subcontractor_id)return null
 return (await operationsDb(`partner_onboarding_invites?subcontractor_id=eq.${row.subcontractor_id}&order=created_at.desc&limit=1`))[0]||null
}
export async function paymentStatus(inviteId?:string) {
 if(!inviteId)return {status:'not_received',document:null}
 const rows=await operationsDb(`contractor_payment_documents?invite_id=eq.${encodeURIComponent(inviteId)}&order=created_at.desc&limit=1`)
 const doc=rows[0]||null
 return {status:doc?(doc.verified_at?'verified':'received'):'not_received',document:doc}
}
export function reviewedInvite(invite:any) {
 const docs=invite?.checklist?.onboardingDocuments || [],reviewed=invite?.checklist?.reviewedDocumentIds || []
 return !!invite?.checklist?.documentsReviewedAt && ['registration','insurance','identity','additional_insured'].every(kind=>docs.some((d:any)=>d.kind===kind&&reviewed.includes(d.id)))
}
