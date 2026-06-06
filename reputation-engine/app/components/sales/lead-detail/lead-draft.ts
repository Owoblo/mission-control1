import { buildLeadSignature } from './helpers'
import { getLeadAssignedRepName } from '../../../../lib/sales'
import type { CRMLead, InventoryItem, JobFactors } from '../../../../lib/types'

export type LeadDraftState = {
  stage: CRMLead['stage']
  followUpDate: string
  followUpStatus: CRMLead['followUpStatus'] | ''
  leadName: string
  leadPhone: string
  leadEmail: string
  moveDate: string
  moveDateFlexible: boolean
  moveDateFlexibleReason: string
  moveType: CRMLead['moveType']
  propertyBedrooms?: CRMLead['propertyBedrooms']
  propertyType?: CRMLead['propertyType']
  originStairFlights?: number
  destStairFlights?: number
  originElevatorAccess?: boolean
  destElevatorAccess?: boolean
  branch?: CRMLead['branch']
  leadSource: string
  referralCustomerName: string
  originAddress: string
  originCity: string
  originAccess: string
  destAddress: string
  destCity: string
  destAccess: string
  parkingNotes: string
  moveReason: string
  customerPriority: string
  notes: string
  realtorBrokerage: string
  inventory?: InventoryItem[]
  jobFactors: JobFactors
  contextFlag: string
  assignedRep: string
  assignedRepUserId: string
  estimateDate: string
  estimateTime: string
  lostReason: string
  lostNotes: string
}

function getDraftLeadName(lead: CRMLead) {
  if (lead.leadKind === 'realtor_opportunity' && lead.primaryContactRole !== 'customer') {
    return lead.realtorName || ''
  }
  return lead.name || ''
}

function getDraftLeadPhone(lead: CRMLead) {
  if (lead.leadKind === 'realtor_opportunity' && lead.primaryContactRole !== 'customer') {
    return lead.realtorPhone || ''
  }
  return lead.phone || ''
}

function getDraftLeadEmail(lead: CRMLead) {
  if (lead.leadKind === 'realtor_opportunity' && lead.primaryContactRole !== 'customer') {
    return lead.realtorEmail || ''
  }
  return lead.email || ''
}

export function createLeadDraftState(lead: CRMLead): LeadDraftState {
  return {
    stage: lead.stage || 'new',
    followUpDate: lead.followUpDate || '',
    followUpStatus: lead.followUpStatus || '',
    leadName: getDraftLeadName(lead),
    leadPhone: getDraftLeadPhone(lead),
    leadEmail: getDraftLeadEmail(lead),
    moveDate: lead.moveDate || '',
    moveDateFlexible: !!lead.moveDateFlexible,
    moveDateFlexibleReason: lead.moveDateFlexibleReason || '',
    moveType: (lead.moveType || 'residential') as CRMLead['moveType'],
    propertyBedrooms: lead.propertyBedrooms,
    propertyType: lead.propertyType,
    originStairFlights: lead.originStairFlights ?? 0,
    destStairFlights: lead.destStairFlights ?? 0,
    originElevatorAccess: lead.originElevatorAccess,
    destElevatorAccess: lead.destElevatorAccess,
    branch: lead.branch,
    leadSource: lead.source || '',
    referralCustomerName: lead.referralCustomerName || '',
    originAddress: lead.originAddress || '',
    originCity: lead.originCity || '',
    originAccess: lead.originAccess || '',
    destAddress: lead.destAddress || '',
    destCity: lead.destCity || '',
    destAccess: lead.destAccess || '',
    parkingNotes: lead.parkingNotes || '',
    moveReason: lead.moveReason || '',
    customerPriority: lead.customerPriority || '',
    notes: lead.notes || '',
    realtorBrokerage: lead.realtorBrokerage || '',
    inventory: lead.inventory || [],
    jobFactors: lead.jobFactors || {},
    contextFlag: lead.contextFlag || '',
    assignedRep: getLeadAssignedRepName(lead) || '',
    assignedRepUserId: lead.assignedRepUserId || '',
    estimateDate: lead.estimateDate || '',
    estimateTime: lead.estimateTime || '',
    lostReason: lead.lostReason || '',
    lostNotes: lead.lostNotes || '',
  }
}

export function buildSavedLeadSignature(lead: CRMLead) {
  return buildLeadSignature({
    name: getDraftLeadName(lead),
    phone: getDraftLeadPhone(lead),
    email: getDraftLeadEmail(lead),
    moveDate: lead.moveDate || '',
    moveDateFlexible: !!lead.moveDateFlexible,
    moveDateFlexibleReason: lead.moveDateFlexibleReason || '',
    moveType: lead.moveType || '',
    propertyBedrooms: lead.propertyBedrooms || '',
    propertyType: lead.propertyType || '',
    originStairFlights: lead.originStairFlights ?? 0,
    destStairFlights: lead.destStairFlights ?? 0,
    originElevatorAccess: lead.originElevatorAccess,
    destElevatorAccess: lead.destElevatorAccess,
    branch: lead.branch || '',
    source: lead.source || '',
    originAddress: lead.originAddress || '',
    originCity: lead.originCity || '',
    originAccess: lead.originAccess || '',
    destAddress: lead.destAddress || '',
    destCity: lead.destCity || '',
    destAccess: lead.destAccess || '',
    parkingNotes: lead.parkingNotes || '',
    realtorBrokerage: lead.realtorBrokerage || '',
    moveReason: lead.moveReason || '',
    notes: lead.notes || '',
    stage: lead.stage || '',
    contextFlag: lead.contextFlag || '',
    followUpDate: lead.followUpDate || '',
    followUpStatus: lead.followUpStatus || '',
    referralCustomerName: lead.referralCustomerName || '',
    assignedRepName: getLeadAssignedRepName(lead) || '',
    assignedRepUserId: lead.assignedRepUserId || '',
    estimateDate: lead.estimateDate || '',
    estimateTime: lead.estimateTime || '',
    lostReason: lead.lostReason || '',
    lostNotes: lead.lostNotes || '',
    jobFactors: lead.jobFactors || {},
    inventory: [],
  })
}

export function buildDraftLeadSignature(draft: LeadDraftState) {
  return buildLeadSignature({
    name: draft.leadName,
    phone: draft.leadPhone,
    email: draft.leadEmail,
    moveDate: draft.moveDate,
    moveDateFlexible: draft.moveDateFlexible,
    moveDateFlexibleReason: draft.moveDateFlexibleReason,
    moveType: draft.moveType || '',
    propertyBedrooms: draft.propertyBedrooms || '',
    propertyType: draft.propertyType || '',
    originStairFlights: draft.originStairFlights ?? 0,
    destStairFlights: draft.destStairFlights ?? 0,
    originElevatorAccess: draft.originElevatorAccess,
    destElevatorAccess: draft.destElevatorAccess,
    branch: draft.branch || '',
    source: draft.leadSource,
    originAddress: draft.originAddress,
    originCity: draft.originCity,
    originAccess: draft.originAccess,
    destAddress: draft.destAddress,
    destCity: draft.destCity,
    destAccess: draft.destAccess,
    parkingNotes: draft.parkingNotes,
    realtorBrokerage: draft.realtorBrokerage,
    moveReason: draft.moveReason,
    notes: draft.notes,
    stage: draft.stage,
    contextFlag: draft.contextFlag,
    followUpDate: draft.followUpDate,
    followUpStatus: draft.followUpStatus,
    referralCustomerName: draft.referralCustomerName,
    assignedRepName: draft.assignedRep,
    assignedRepUserId: draft.assignedRepUserId,
    estimateDate: draft.estimateDate,
    estimateTime: draft.estimateTime,
    lostReason: draft.lostReason,
    lostNotes: draft.lostNotes,
    jobFactors: draft.jobFactors,
    inventory: [],
  })
}

export function buildLeadDraftPayload(
  lead: CRMLead,
  draft: LeadDraftState,
) {
  const preserveOpportunityIdentity =
    lead.leadKind === 'realtor_opportunity' &&
    lead.primaryContactRole !== 'customer'

  return {
    name: preserveOpportunityIdentity ? (lead.name || undefined) : draft.leadName,
    phone: preserveOpportunityIdentity ? (lead.phone || undefined) : (draft.leadPhone || undefined),
    email: preserveOpportunityIdentity ? (lead.email || undefined) : (draft.leadEmail || undefined),
    moveDate: draft.moveDate || undefined,
    moveDateFlexible: draft.moveDateFlexible || undefined,
    moveDateFlexibleReason: draft.moveDateFlexibleReason || undefined,
    moveType: draft.moveType || undefined,
    propertyBedrooms: draft.propertyBedrooms || undefined,
    propertyType: draft.propertyType || undefined,
    originStairFlights: draft.originStairFlights,
    destStairFlights: draft.destStairFlights,
    originElevatorAccess: draft.originElevatorAccess,
    destElevatorAccess: draft.destElevatorAccess,
    branch: draft.branch || undefined,
    source: draft.leadSource || undefined,
    referralCustomerName: draft.leadSource === 'customer_referral' ? (draft.referralCustomerName || '') : '',
    originAddress: draft.originAddress || undefined,
    originCity: draft.originCity || undefined,
    originAccess: draft.originAccess || undefined,
    destAddress: draft.destAddress || undefined,
    destCity: draft.destCity || undefined,
    destAccess: draft.destAccess || undefined,
    parkingNotes: draft.parkingNotes || undefined,
    stage: draft.stage,
    followUpDate: draft.followUpDate || undefined,
    followUpStatus: draft.followUpStatus || undefined,
    realtorName: preserveOpportunityIdentity ? (draft.leadName || undefined) : lead.realtorName,
    realtorPhone: preserveOpportunityIdentity ? (draft.leadPhone || undefined) : lead.realtorPhone,
    realtorEmail: preserveOpportunityIdentity ? (draft.leadEmail || undefined) : lead.realtorEmail,
    realtorBrokerage: draft.realtorBrokerage || undefined,
    moveReason: draft.moveReason,
    customerPriority: draft.customerPriority || undefined,
    notes: draft.notes,
    jobFactors: Object.keys(draft.jobFactors).length > 0 ? draft.jobFactors : undefined,
    contextFlag: draft.contextFlag || undefined,
    ...(draft.assignedRep ? { assignedRep: draft.assignedRep, assignedRepName: draft.assignedRep } : {}),
    ...(draft.assignedRepUserId ? { assignedRepUserId: draft.assignedRepUserId } : {}),
    estimateDate: draft.estimateDate || undefined,
    estimateTime: draft.estimateTime || undefined,
    lostReason: draft.lostReason || undefined,
    lostNotes: draft.lostNotes || undefined,
  }
}
