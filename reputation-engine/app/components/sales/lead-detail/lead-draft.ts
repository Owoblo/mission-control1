import { buildRoomBreakdown, buildLeadSignature } from '@/app/components/sales/lead-detail/helpers'
import { getLeadAssignedRepName } from '@/lib/sales'
import type { CRMLead, InventoryItem, JobFactors } from '@/lib/types'

export type LeadDraftState = {
  stage: CRMLead['stage']
  followUpDate: string
  leadName: string
  leadPhone: string
  leadEmail: string
  moveDate: string
  moveDateFlexible: boolean
  moveDateFlexibleReason: string
  moveType: CRMLead['moveType']
  branch?: CRMLead['branch']
  leadSource: string
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
  inventory: InventoryItem[]
  jobFactors: JobFactors
  contextFlag: string
  assignedRep: string
  assignedRepUserId: string
  estimateDate: string
  estimateTime: string
  lostReason: string
  lostNotes: string
}

type LeadInventoryMetrics = {
  inventory: InventoryItem[]
  totalItems: number
  totalCubicFeet: number
  totalWeightLbs: number
}

function getDraftLeadName(lead: CRMLead) {
  if (lead.leadKind === 'realtor_opportunity' && lead.primaryContactRole !== 'customer') {
    return lead.realtorName || lead.name || ''
  }
  return lead.name || ''
}

function getDraftLeadPhone(lead: CRMLead) {
  if (lead.leadKind === 'realtor_opportunity' && lead.primaryContactRole !== 'customer') {
    return lead.realtorPhone || lead.phone || ''
  }
  return lead.phone || ''
}

function getDraftLeadEmail(lead: CRMLead) {
  if (lead.leadKind === 'realtor_opportunity' && lead.primaryContactRole !== 'customer') {
    return lead.realtorEmail || lead.email || ''
  }
  return lead.email || ''
}

export function createLeadDraftState(lead: CRMLead): LeadDraftState {
  return {
    stage: lead.stage || 'new',
    followUpDate: lead.followUpDate || '',
    leadName: getDraftLeadName(lead),
    leadPhone: getDraftLeadPhone(lead),
    leadEmail: getDraftLeadEmail(lead),
    moveDate: lead.moveDate || '',
    moveDateFlexible: !!lead.moveDateFlexible,
    moveDateFlexibleReason: lead.moveDateFlexibleReason || '',
    moveType: (lead.moveType || 'residential') as CRMLead['moveType'],
    branch: lead.branch,
    leadSource: lead.source || '',
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
    assignedRepName: getLeadAssignedRepName(lead) || '',
    assignedRepUserId: lead.assignedRepUserId || '',
    estimateDate: lead.estimateDate || '',
    estimateTime: lead.estimateTime || '',
    lostReason: lead.lostReason || '',
    lostNotes: lead.lostNotes || '',
    jobFactors: lead.jobFactors || {},
    inventory: lead.inventory || [],
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
    assignedRepName: draft.assignedRep,
    assignedRepUserId: draft.assignedRepUserId,
    estimateDate: draft.estimateDate,
    estimateTime: draft.estimateTime,
    lostReason: draft.lostReason,
    lostNotes: draft.lostNotes,
    jobFactors: draft.jobFactors,
    inventory: draft.inventory,
  })
}

export function buildLeadDraftPayload(
  lead: CRMLead,
  draft: LeadDraftState,
  inventoryMetrics: LeadInventoryMetrics,
) {
  return {
    name: draft.leadName,
    phone: draft.leadPhone || undefined,
    email: draft.leadEmail || undefined,
    moveDate: draft.moveDate || undefined,
    moveDateFlexible: draft.moveDateFlexible || undefined,
    moveDateFlexibleReason: draft.moveDateFlexibleReason || undefined,
    moveType: draft.moveType || undefined,
    branch: draft.branch || undefined,
    source: draft.leadSource || undefined,
    originAddress: draft.originAddress || undefined,
    originCity: draft.originCity || undefined,
    originAccess: draft.originAccess || undefined,
    destAddress: draft.destAddress || undefined,
    destCity: draft.destCity || undefined,
    destAccess: draft.destAccess || undefined,
    parkingNotes: draft.parkingNotes || undefined,
    stage: draft.stage,
    followUpDate: draft.followUpDate || undefined,
    realtorName: lead.leadKind === 'realtor_opportunity' && lead.primaryContactRole !== 'customer' ? (draft.leadName || undefined) : lead.realtorName,
    realtorPhone: lead.leadKind === 'realtor_opportunity' && lead.primaryContactRole !== 'customer' ? (draft.leadPhone || undefined) : lead.realtorPhone,
    realtorEmail: lead.leadKind === 'realtor_opportunity' && lead.primaryContactRole !== 'customer' ? (draft.leadEmail || undefined) : lead.realtorEmail,
    realtorBrokerage: draft.realtorBrokerage || undefined,
    moveReason: draft.moveReason,
    customerPriority: draft.customerPriority || undefined,
    notes: draft.notes,
    inventory: inventoryMetrics.inventory,
    totalItems: inventoryMetrics.totalItems,
    totalCubicFeet: inventoryMetrics.totalCubicFeet,
    totalWeightLbs: inventoryMetrics.totalWeightLbs,
    roomBreakdown: buildRoomBreakdown(inventoryMetrics.inventory),
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
