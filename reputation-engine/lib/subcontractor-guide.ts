export const CONTRACTOR_PAYMENT_TERMS = 'We pay by direct deposit within seven calendar days of job completion, provided we have received your invoice and required completion records. If these arrive later, the seven-day period starts when both are received. Additional work must be approved by Saturn and recorded before invoicing.'

export const contractorFaqs = [
  ['What kind of work can I take?', 'Residential and commercial moving, truck-and-driver work, labour-only support, and specialist jobs where your experience and equipment match the scope. Tell us about your service area, crew, trucks and any specialist capabilities. Each job is reviewed individually.'],
  ['Do I have to own a truck?', 'No. Owned, leased and rented trucks can all be considered. Tell us which vehicles you can reliably provide and how much notice you need. Labour-only teams can also be considered for suitable jobs.'],
  ['Is the work flat-rate or hourly?', 'Either can work. We agree the pricing basis, included work and payout before you accept. Flat-rate offers have a defined scope. Hourly work must specify the agreed rate, how time is recorded and any minimums or additional charges.'],
  ['Can I decline an offer?', 'Yes. Review the scope, payout and date, and take the jobs that fit your team. Joining the network does not guarantee a number of jobs. An offer is not a confirmed assignment until Saturn confirms the award.'],
  ['What information do I receive?', 'Before accepting, you receive the job date, pickup and destination areas, estimated distance, inventory, access details, floors, crew and truck requirements, known complexities and proposed payout. Full addresses and necessary customer contact details are shared with the assigned crew after confirmation.'],
  ['When will I get paid?', CONTRACTOR_PAYMENT_TERMS],
  ['What completion records do you need?', 'Your job reference, a completion confirmation, any required time records and photos, and approved scope changes. Your invoice should match the agreed payout and approved extras. We confirm the job-specific requirements before you accept.'],
  ['What if the job is different when I arrive?', 'Document what differs, take relevant photos where appropriate, and contact Saturn before doing additional work. We confirm the revised scope and any payout adjustment in writing. Stop any unsafe work and call us immediately. Do not agree extra charges directly with the customer.'],
  ['Who handles the customer?', 'Saturn manages the booking, pricing, payments, complaints and future work. Be courteous and communicate practical moving details with the customer. Route commercial decisions and scope changes through Saturn; do not solicit separate work or collect customer payments unless specifically authorized.'],
  ['What documents should I prepare?', 'Your business registration, proof of insurance and ID. We also require evidence that MARS RELOCATION SERVICES INC has been added as an additional insured for your work with Saturn; we will confirm the details your insurer needs. Upload documents through your private onboarding form for review. Submitting a form does not mean you are approved for dispatch.'],
  ['What standards will my team follow?', 'Arrive at the agreed time with the confirmed crew, vehicle and equipment. Protect the property and goods, communicate delays promptly, and report incidents immediately. Saturn shirts and temporary truck branding may be required for assigned jobs; we agree the arrangements with you in advance.'],
  ['What if I need to cancel or cannot reach the customer?', 'Contact Saturn immediately. Do not substitute another crew or vehicle without approval. Any cancellation or waiting-time terms are agreed for the job; do not assume an extra fee or a replacement assignment.'],
] as const

export const contractorPlaybook = [
  { id: 'relationship', title: '1. Start with the relationship', items: [
    'Read the existing calls, texts and notes before contacting anyone. Continue the conversation naturally; use confirmed names and ask for missing details. Close existing-thread messages with John, SSM.',
    'Send the public overview when requested. Ask for a preferred email if a link text fails. Preserve the original regional sender, honour declines and opt-outs, and do not blindly retry failed or ambiguous sends.',
    'Record the person who makes dispatch decisions, their direct number, preferred channel, response hours and backup contact. A sales inbox is not a confirmed dispatch contact.',
    'After a fit conversation, create the contractor-specific onboarding link from their CRM profile. Never send the preview link as an application. Keep outreach status separate from dispatch approval.',
  ]},
  { id: 'review', title: '2. Review the application and documents', items: [
    'Capture business registration, insurance, ID and additional-insured evidence for MARS RELOCATION SERVICES INC. Confirm insurer-specific details before requesting the endorsement. Store documents in the private onboarding flow, not public notes or pages.',
    'Collect truck sizes, counts and ownership/lease/rental arrangements, crew capacity, reliable coverage, notice periods, equipment, rates and special handling experience. Verify capability before routing machinery, hot tubs, pool tables or other specialist work.',
    'The form can submit while documents are missing. Keep it in verification with outstanding items visible. No job dispatch until required checks, documents, agreement and activation have been completed.',
    'Review validity, expiry and relevant coverage; a document upload or verbal insurance claim is not verification. The existing review gate requires all four document categories and an explicit staff review before agreement.',
  ]},
  { id: 'agreement', title: '3. Agree the working terms', items: [
    'Record accepted service standards, customer communication boundaries, agreed branding arrangements, scope-change procedure, completion records and payment terms. The public guide explains the process; it does not replace the written agreement.',
    CONTRACTOR_PAYMENT_TERMS,
    'Confirm payment details through the approved secure payment process. Do not request bank details or identity documents by ordinary text. Existing written job terms must be reviewed before changing them retrospectively.',
    'Track the relationship as contacted, conversation, application, verification, agreement, approved, or paused in the appropriate existing records. These are operating milestones, not permission to bypass the eligibility gate.',
  ]},
  { id: 'offer', title: '4. Offer a clearly scoped job', items: [
    'Confirm the customer booking and deposit in the CRM before offering secured work. Match approved contractors to area, date, crew size, truck, equipment, verified skills and current insurance.',
    'Share cities/areas, estimated distance, inventory, access, floors, timing, truck and crew requirements, special handling and known exclusions. Keep full customer identity, exact addresses and contact details out of pre-award offers.',
    'Record whether the payout is flat or hourly, the amount, tax treatment, included expenses, travel/waiting rules, any minimums, and payment terms. Do not substitute a contractor’s advertised retail rate for an agreed subcontract rate.',
    'Compare availability, capacity, service reliability and payout. A reply or acceptance is not the award. Confirm one assignment and resolve other offers before releasing the full crew briefing.',
  ]},
  { id: 'dispatch', title: '5. Confirm the crew and job-day standards', items: [
    'Before dispatch, record the crew lead and direct mobile, team size, exact truck and equipment, arrival time and any access/warehouse clearance requirements. Release full job details only to the assigned team.',
    'Confirm protective materials, uniforms and any agreed temporary vehicle branding. Give the crew an escalation contact and instructions for delays, incidents and unsafe conditions.',
    'Crews may discuss practical moving details politely with customers. Saturn controls pricing, additional work, complaints, collections and future bookings. Do not use a blanket instruction that prevents normal safety or moving communication.',
  ]},
  { id: 'changes', title: '6. Handle scope changes before extra work', items: [
    'Capture the discrepancy, supporting photos where appropriate, affected items/access, requested additional time or equipment, and the contractor’s proposed adjustment against the job.',
    'Review the customer impact and obtain the necessary approval. Record the revised scope and subcontractor payout in writing before authorizing the extra work. Never let the crew negotiate customer charges directly.',
    'If agreement is not reached, pause the affected work and escalate. Stop unsafe work immediately. Log accidents and damage promptly without promising an unapproved settlement.',
  ]},
  { id: 'payment', title: '7. Close the job and pay predictably', items: [
    'Collect completion confirmation, required time records/photos, invoice and approved adjustments. Check that the invoice matches the agreed job and tax treatment. Tell the contractor promptly and specifically if anything is missing.',
    'Record the payment-start date as the later of job completion and receipt of both the invoice and required completion records. The due date is seven calendar days after that date, using Toronto calendar dates. Example: completion October 20 and all records received October 21 means payment due October 28.',
    'Record base payout, approved extras, tax, total, due date, missing items and payment status in the job/payment records. Review upcoming due dates daily and arrange payment early enough for weekends or bank-processing delays.',
    'The seven-day timetable is not contingent on collecting the customer balance. Do not silently restart the clock or mark a payment made because it was merely planned. Save the transfer confirmation and paid date when payment is actually sent.',
    'Escalate any disputed amount promptly, record the issue and communicate the next step. Do not invent blanket penalties, deductions or indefinite payment holds. Resolve treatment with the owner under the agreed terms.',
    'This playbook defines the workflow. It does not install an automatic bank payout or new due-date scheduler; staff must record and review due dates using the existing job/payment records.',
  ]},
  { id: 'quality', title: '8. Review performance and maintain the relationship', items: [
    'Record punctuality, communication, scope adherence, care of goods, incidents, invoice accuracy and customer feedback. Distinguish a declined offer from a cancelled confirmed assignment.',
    'Recheck expiring documents, capacity, rates and dispatch contacts. Pause eligibility when required checks lapse or an unresolved issue makes dispatch unsuitable.',
    'Keep owner-requested outreach holds explicit in the contractor record. A new guide or campaign does not release an existing hold or confirm that a payment has been made.',
  ]},
] as const
