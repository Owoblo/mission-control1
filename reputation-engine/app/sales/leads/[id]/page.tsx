'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { ConsultationBookingModal } from '@/app/components/sales/consultation-booking-modal'
import { EstimateDraftModal } from '@/app/components/sales/lead-detail/estimate-draft-modal'
import { FastLaneModal } from '@/app/components/sales/fast-lane-modal'
import dynamic from 'next/dynamic'
const CollectCardModal = dynamic(
  () => import('@/app/components/sales/collect-card-modal').then(m => ({ default: m.CollectCardModal })),
  { ssr: false }
)
import { LeadBasicsPanel } from '@/app/components/sales/lead-detail/lead-basics-panel'
import { LeadIntelligencePanel } from '@/app/components/sales/lead-detail/lead-intelligence-panel'
import { LeadTimeline } from '@/app/components/sales/lead-detail/lead-timeline'
import { useCurrentUser } from '@/lib/hooks/use-current-user'
import {
  DEFAULT_ROOM_OPTIONS,
  buildRoomBreakdown,
  buildLeadSignature,
  normalizeRoomName,
} from '@/app/components/sales/lead-detail/helpers'
import { INVENTORY_PRESETS, createInventoryItemFromPreset } from '@/lib/item-presets'
import { getMovePolicyFinding } from '@/lib/move-policy'
import { formatRelativeTime, getLeadGuidance } from '@/lib/lead-guidance'
import {
  getDefaultSaturnBranchNumber,
  getSaturnBranchLabel,
  getSaturnBusinessNumberFromSmsMessage,
  pickSaturnBranchPhoneNumber,
} from '@/lib/sales-phones'
import { DEPOSIT_METHODS, LEAD_CONTEXT_FLAGS, LOST_REASONS, SALES_LEAD_STAGES, computeQuoteTotals, deriveInventoryMetrics, estimateLeadQuote, formatDate, formatDateTime, formatMoney, getLeadAssignedRepName, getSalesBranchLabel, isBookedLikeStage, isClosedLeadStage } from '@/lib/sales'
import { confirmJob, createLeadQuote, deleteSalesLead, enrichSalesAddress, fetchSalesLead, fetchSalesOverview, fetchSalesQuote, fetchSalesUsers, handoffRealtorOpportunityLead, saveLeadConsultation, saveSalesFollowUp, sendSalesMessage, updateSalesLead, updateSalesQuote, uploadLeadMedia } from '@/lib/sales-api'
import type { UserRole } from '@/lib/auth'
import type {
  CRMAutomationJob,
  CRMLead,
  CRMQuote,
  EstimateRouteContext,
  FollowUpLog,
  InventoryItem,
  JobFactors,
  LeadAutomationSettings,
  QuoteLineItem,
} from '@/lib/types'

interface SalesUserOption {
  id: string
  name: string
  role: UserRole
}

const DEFAULT_AUTOMATION_SETTINGS: Required<LeadAutomationSettings> = {
  nudgeIfQuoteNotOpened: true,
  nudgeIfSurveyNotCompleted: true,
  nudgeIfQuoteViewedNoResponse: true,
  nudgeBeforeQuoteExpires: true,
}

function resolveAutomationSettings(settings?: LeadAutomationSettings | null): Required<LeadAutomationSettings> {
  return {
    ...DEFAULT_AUTOMATION_SETTINGS,
    ...(settings || {}),
  }
}

function automationJobLabel(job: CRMAutomationJob) {
  if (job.kind === 'quote_followup') return 'Quote not opened'
  if (job.kind === 'quote_viewed_followup') return 'Quote viewed, no response'
  if (job.kind === 'quote_expiry_followup') return 'Quote expires soon'
  if (job.kind === 'survey_followup') return 'Survey incomplete'
  if (job.kind === 'move_reminder') return 'Booked move reminder'
  if (job.kind === 'stale_reactivation') return 'Stale lead reactivation'
  return 'Scheduled automation'
}

export default function SalesLeadDetailPage() {
  const params = useParams() as { id?: string }
  const router = useRouter()
  const searchParams = useSearchParams()
  const currentUser = useCurrentUser()
  const estimateIntent = searchParams?.get('estimate') === '1'
  const [lead, setLead] = useState<CRMLead | null>(null)
  const [quote, setQuote] = useState<CRMQuote | null>(null)
  const [followUps, setFollowUps] = useState<FollowUpLog[]>([])
  const [automationSettings, setAutomationSettings] = useState<Required<LeadAutomationSettings>>(DEFAULT_AUTOMATION_SETTINGS)
  const [automationJobs, setAutomationJobs] = useState<CRMAutomationJob[]>([])
  const [automationLoading, setAutomationLoading] = useState(false)
  const [automationSavingKey, setAutomationSavingKey] = useState<string | null>(null)
  const [showUnsavedLeaveModal, setShowUnsavedLeaveModal] = useState(false)
  const [unsavedLeaveBusy, setUnsavedLeaveBusy] = useState(false)
  const [stage, setStage] = useState<CRMLead['stage']>('new')
  const [followUpDate, setFollowUpDate] = useState('')
  const [leadName, setLeadName] = useState('')
  const [leadPhone, setLeadPhone] = useState('')
  const [leadEmail, setLeadEmail] = useState('')
  const [moveDate, setMoveDate] = useState('')
  const [moveDateFlexible, setMoveDateFlexible] = useState(false)
  const [moveDateFlexibleReason, setMoveDateFlexibleReason] = useState('')
  const [moveType, setMoveType] = useState<CRMLead['moveType']>('residential')
  const [branch, setBranch] = useState<CRMLead['branch']>()
  const [leadSource, setLeadSource] = useState('')
  const [originAddress, setOriginAddress] = useState('')
  const [originCity, setOriginCity] = useState('')
  const [originAccess, setOriginAccess] = useState('')
  const [destAddress, setDestAddress] = useState('')
  const [destCity, setDestCity] = useState('')
  const [destAccess, setDestAccess] = useState('')
  const [parkingNotes, setParkingNotes] = useState('')
  const [moveReason, setMoveReason] = useState('')
  const [notes, setNotes] = useState('')
  const [realtorBrokerage, setRealtorBrokerage] = useState('')
  const [inventory, setInventory] = useState<InventoryItem[]>([])
  const [inventoryLoading, setInventoryLoading] = useState(false)
  const [analysisBusy, setAnalysisBusy] = useState(false)
  const [activePhotoIndex, setActivePhotoIndex] = useState(0)
  const [activityType, setActivityType] = useState<FollowUpLog['type']>('call')
  const [activityNotes, setActivityNotes] = useState('')
  const [presetSearch, setPresetSearch] = useState('')
  const [saving, setSaving] = useState(false)
  const [creatingQuote, setCreatingQuote] = useState(false)
  const [surveyBusy, setSurveyBusy] = useState(false)
  const existingSurveyToken = (lead as unknown as Record<string, unknown>)?.surveyToken as string | undefined
  const [surveyUrl, setSurveyUrl] = useState<string | null>(
    existingSurveyToken && existingSurveyToken !== 'set'
      ? (typeof window !== 'undefined' ? `${window.location.origin}/survey/${existingSurveyToken}` : null)
      : null
  )
  const [mediaUploadRoom, setMediaUploadRoom] = useState<string>('Living Room')
  const [mediaUploadFiles, setMediaUploadFiles] = useState<File[]>([])
  const [mediaUploadBusy, setMediaUploadBusy] = useState(false)
  const [mediaUploadNotice, setMediaUploadNotice] = useState<string | null>(null)
  const [loggingActivity, setLoggingActivity] = useState(false)
  const [consultationActive, setConsultationActive] = useState(false)
  const [consultationSaving, setConsultationSaving] = useState(false)
  const [consultationNotes, setConsultationNotes] = useState('')
  const [consultationSummary, setConsultationSummary] = useState('')
  const [consultationSeconds, setConsultationSeconds] = useState(0)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [leadCommandBarCompact, setLeadCommandBarCompact] = useState(false)
  const [guidancePanelCollapsed, setGuidancePanelCollapsed] = useState(() => {
    try { return localStorage.getItem('ss_guidance_collapsed') === '1' } catch { return false }
  })
  function toggleGuidancePanel() {
    setGuidancePanelCollapsed(v => {
      const next = !v
      try { localStorage.setItem('ss_guidance_collapsed', next ? '1' : '0') } catch {}
      return next
    })
  }
  const [contextFlag, setContextFlag] = useState<string>('')
  const [assignedRep, setAssignedRep] = useState<string>('')
  const [assignedRepUserId, setAssignedRepUserId] = useState<string>('')
  const [salesUsers, setSalesUsers] = useState<SalesUserOption[]>([])
  const [estimateDate, setEstimateDate] = useState<string>('')
  const [estimateTime, setEstimateTime] = useState<string>('')
  // Lost reason modal
  const [showLostModal, setShowLostModal] = useState(false)
  const [lostReason, setLostReason] = useState<string>('')
  const [lostNotes, setLostNotes] = useState<string>('')
  const [pendingStage, setPendingStage] = useState<CRMLead['stage'] | null>(null)
  const [fastLaneOpen, setFastLaneOpen] = useState(false)
  const [showApptSmsModal, setShowApptSmsModal] = useState(false)
  const [apptSmsPendingPayload, setApptSmsPendingPayload] = useState<Record<string, unknown> | null>(null)
  const [showConsultationModal, setShowConsultationModal] = useState(false)
  const [showPhotoRequestDialog, setShowPhotoRequestDialog] = useState(false)
  const [photoRequestData, setPhotoRequestData] = useState<{ surveyUrl: string; draftSms: string; token: string } | null>(null)
  const [photoRequestSmsBody, setPhotoRequestSmsBody] = useState('')
  const [photoRequestSending, setPhotoRequestSending] = useState(false)
  const [dispatchBriefOpen, setDispatchBriefOpen] = useState(false)
  const [dispatchBriefText, setDispatchBriefText] = useState('')
  const [dispatchBriefBusy, setDispatchBriefBusy] = useState(false)
  // Confirm job modal
  const [showConfirmJobModal, setShowConfirmJobModal] = useState(false)
  const [confirmJobDeposit, setConfirmJobDeposit] = useState<string>('')
  const [confirmJobDepositMethod, setConfirmJobDepositMethod] = useState<string>('E-Transfer')
  const [confirmJobBusy, setConfirmJobBusy] = useState(false)
  const [depositLinkBusy, setDepositLinkBusy] = useState(false)
  const [logDepositOpen, setLogDepositOpen] = useState(false)
  const [logDepositMethod, setLogDepositMethod] = useState<'cash' | 'etransfer' | 'cheque'>('etransfer')
  const [logDepositNote, setLogDepositNote] = useState('')
  const [logDepositBusy, setLogDepositBusy] = useState(false)
  const [chargeBalanceBusy, setChargeBalanceBusy] = useState(false)
  const [sendInvoiceBusy, setSendInvoiceBusy] = useState(false)
  const [reviewSentBusy, setReviewSentBusy] = useState(false)
  const [reviewSent, setReviewSent] = useState(false)
  const [collectCardOpen, setCollectCardOpen] = useState(false)
  const [incidentOpen, setIncidentOpen] = useState(false)
  const [incidentType, setIncidentType] = useState<'damage' | 'complaint' | 'lost_item' | 'delay' | 'other'>('damage')
  const [incidentDesc, setIncidentDesc] = useState('')
  const [incidentBusy, setIncidentBusy] = useState(false)
  const [quoteModalOpen, setQuoteModalOpen] = useState(false)
  const [quoteModalBusy, setQuoteModalBusy] = useState(false)
  const [quoteModalDirty, setQuoteModalDirty] = useState(false)
  const [additionalQuotes, setAdditionalQuotes] = useState<CRMQuote[]>([])
  const [quoteLineItems, setQuoteLineItems] = useState<QuoteLineItem[]>([])
  const [quoteDiscountAmount, setQuoteDiscountAmount] = useState(0)
  const [quoteDiscountLabel, setQuoteDiscountLabel] = useState('')
  const [quoteMoveDescription, setQuoteMoveDescription] = useState('')
  const [quoteInternalNotes, setQuoteInternalNotes] = useState('')
  const [jobFactors, setJobFactors] = useState<JobFactors>({})
  const [recalculateBusy, setRecalculateBusy] = useState(false)
  const pricingMetaRef = useRef<{
    crewSize: number
    estimatedHours: number
    truckCount: number
    estimatedWeightLbs?: number
    longDistanceDistanceKm?: number
    longDistanceTruckCost?: number
    longDistanceGasCost?: number
    longDistanceInsuranceCost?: number
    longDistanceMiscCost?: number
    longDistanceMarkupRate?: number
  }>({ crewSize: 3, estimatedHours: 3, truckCount: 1 })
  const composerUserEdited = useRef(false)
  const [outcomeOpen, setOutcomeOpen] = useState(false)
  const [outcomeActualHours, setOutcomeActualHours] = useState('')
  const [outcomeActualCrew, setOutcomeActualCrew] = useState('')
  const [outcomeDamage, setOutcomeDamage] = useState(false)
  const [outcomeRating, setOutcomeRating] = useState<number>(0)
  const [outcomeReview, setOutcomeReview] = useState(false)
  const [outcomeReferral, setOutcomeReferral] = useState(false)
  const [outcomeNotes, setOutcomeNotes] = useState('')
  const [outcomeBusy, setOutcomeBusy] = useState(false)
  const [outcomeSaved, setOutcomeSaved] = useState(false)
  const [composerOpen, setComposerOpen] = useState(false)
  const [composerChannel, setComposerChannel] = useState<'sms' | 'email'>('sms')
  const [composerSubject, setComposerSubject] = useState('Following up — Saturn Star Moving')
  const [composerBody, setComposerBody] = useState('')
  const [composerBusy, setComposerBusy] = useState(false)
  const [scBusy, setScBusy] = useState(false)
  const [emailMessages, setEmailMessages] = useState<Array<{ id: string; from: string; to: string; subject: string; body: string; direction: 'inbound' | 'outbound'; sentAt: string; leadId?: string | null }>>([])
  const [emailsLoading, setEmailsLoading] = useState(false)
  const [smsMessages, setSmsMessages] = useState<Array<{ id: string; from_number: string; to_number: string; body: string; direction: 'inbound' | 'outbound'; lead_id: string | null; created_at: string; twilio_sid?: string | null }>>([])
  const [smsLoading, setSmsLoading] = useState(false)
  const [smsSending, setSmsSending] = useState(false)
  const [smsInput, setSmsInput] = useState('')
  const [smsChannel, setSmsChannel] = useState<'sms' | 'whatsapp'>('sms')
  const smsAreaRef = useRef<HTMLDivElement>(null)
  const [listingLookupBusy, setListingLookupBusy] = useState(false)
  const [scanProgress, setScanProgress] = useState<{ batch: number; totalBatches: number; status: string } | null>(null)
  const [scanResult, setScanResult] = useState<{ totalItems: number; truckLabel: string; cubicFeet: number; flags: string[] } | null>(null)
  const [activeTab, setActiveTab] = useState<'timeline' | 'emails' | 'sms'>('timeline')
  const [error, setError] = useState<string | null>(null)
  const [handoffName, setHandoffName] = useState('')
  const [handoffPhone, setHandoffPhone] = useState('')
  const [handoffEmail, setHandoffEmail] = useState('')
  const [handoffBusy, setHandoffBusy] = useState(false)
  const [opportunityNotice, setOpportunityNotice] = useState<string | null>(null)
  const previousOpportunityLeadIdRef = useRef<string | undefined>(undefined)
  const consultationRecorderRef = useRef<MediaRecorder | null>(null)
  const consultationStreamRef = useRef<MediaStream | null>(null)
  const consultationChunksRef = useRef<Blob[]>([])
  const mediaUploadInputRef = useRef<HTMLInputElement | null>(null)
  const pendingLeaveActionRef = useRef<'history-back' | string | null>(null)
  const historyGuardArmedRef = useRef(false)
  const bypassLeaveGuardRef = useRef(false)
  const assignmentOptions = useMemo(() => {
    const options = [...salesUsers]
    if (assignedRep && !options.some(user => user.id === assignedRepUserId || user.name === assignedRep)) {
      options.unshift({
        id: assignedRepUserId || `legacy:${assignedRep}`,
        name: assignedRep,
        role: 'sales_rep',
      })
    }
    return options
  }, [assignedRep, assignedRepUserId, salesUsers])
  const assignedRepSelectValue = useMemo(() => {
    if (assignedRepUserId) return assignedRepUserId
    return assignmentOptions.find(user => user.name === assignedRep)?.id || ''
  }, [assignedRep, assignedRepUserId, assignmentOptions])
  const leadOwnerName = useMemo(() => getLeadAssignedRepName(lead) || 'Unassigned', [lead])
  const canReassignCurrentLead = currentUser?.role === 'owner' || currentUser?.role === 'manager'
  const canDeleteCurrentLead = currentUser?.role === 'owner' || currentUser?.role === 'manager'
  const canControlLeadAutomation = useMemo(() => {
    if (!lead || !currentUser) return false
    if (currentUser.role === 'owner' || currentUser.role === 'manager') return true
    const ownerUserId = lead.assignedRepUserId?.trim()
    const ownerName = getLeadAssignedRepName(lead)?.trim()
    if (!ownerUserId && !ownerName) return false
    return currentUser.userId === ownerUserId || (!!currentUser.name && currentUser.name === ownerName)
  }, [currentUser, lead])
  const canHandleCurrentLeadCommunication = useMemo(() => {
    if (!lead || !currentUser) return false
    return currentUser.role === 'owner' || currentUser.role === 'manager' || currentUser.role === 'sales_rep'
  }, [currentUser, lead])
  const canEditCurrentLead = useMemo(() => {
    if (!lead || !currentUser) return false
    if (currentUser.role === 'owner' || currentUser.role === 'manager') return true
    const ownerUserId = lead.assignedRepUserId?.trim()
    const ownerName = getLeadAssignedRepName(lead)?.trim()
    if (!ownerUserId && !ownerName) return true
    return currentUser.userId === ownerUserId || (!!currentUser.name && currentUser.name === ownerName)
  }, [currentUser, lead])
  const leadReadOnlyReason = useMemo(() => {
    if (!lead || !currentUser || canEditCurrentLead) return null
    const ownerName = getLeadAssignedRepName(lead)
    return ownerName
      ? `This lead is assigned to ${ownerName}. You can still handle calls, messages, consultations, and follow-ups here, but only the assigned rep, a manager, or the owner can change core lead details.`
      : 'This lead is view-only for you right now.'
  }, [canEditCurrentLead, currentUser, lead])

  useEffect(() => {
    function syncLeadCommandBarMode() {
      setLeadCommandBarCompact(window.scrollY > 220)
    }

    syncLeadCommandBarMode()
    window.addEventListener('scroll', syncLeadCommandBarMode, { passive: true })
    return () => window.removeEventListener('scroll', syncLeadCommandBarMode)
  }, [])

  function ensureLeadEditable() {
    if (canEditCurrentLead) return true
    setError(leadReadOnlyReason || 'This lead is view-only for you.')
    return false
  }

  function ensureLeadCommunicationAccess() {
    if (canHandleCurrentLeadCommunication) return true
    setError('You do not have access to handle calls or follow-ups on this lead.')
    return false
  }

  function applyLeadSnapshot(nextLead: CRMLead, options?: { hydrateForm?: boolean }) {
    setLead(nextLead)

    if (!options?.hydrateForm) {
      return
    }

    setStage(nextLead.stage || 'new')
    setFollowUpDate(nextLead.followUpDate || '')
    setLeadName(nextLead.name || '')
    setLeadPhone(nextLead.phone || '')
    setLeadEmail(nextLead.email || '')
    setMoveDate(nextLead.moveDate || '')
    setMoveDateFlexible(!!nextLead.moveDateFlexible)
    setMoveDateFlexibleReason(nextLead.moveDateFlexibleReason || '')
    setMoveType((nextLead.moveType || 'residential') as CRMLead['moveType'])
    setBranch(nextLead.branch)
    setLeadSource(nextLead.source || '')
    setOriginAddress(nextLead.originAddress || '')
    setOriginCity(nextLead.originCity || '')
    setOriginAccess(nextLead.originAccess || '')
    setDestAddress(nextLead.destAddress || '')
    setDestCity(nextLead.destCity || '')
    setDestAccess(nextLead.destAccess || '')
    setParkingNotes(nextLead.parkingNotes || '')
    setMoveReason(nextLead.moveReason || '')
    setNotes(nextLead.notes || '')
    setRealtorBrokerage(nextLead.realtorBrokerage || '')
    setInventory(nextLead.inventory || [])
    setJobFactors(nextLead.jobFactors || {})
    setContextFlag(nextLead.contextFlag || '')
    setAssignedRep(getLeadAssignedRepName(nextLead) || '')
    setAssignedRepUserId(nextLead.assignedRepUserId || '')
    setEstimateDate(nextLead.estimateDate || '')
    setEstimateTime(nextLead.estimateTime || '')
    setLostReason(nextLead.lostReason || '')
    setLostNotes(nextLead.lostNotes || '')
    setAutomationSettings(resolveAutomationSettings(nextLead.automationSettings))
    setMediaUploadNotice(null)
    setHandoffName('')
    setHandoffPhone('')
    setHandoffEmail('')
  }

  function mergeFollowUpLog(entry: FollowUpLog) {
    setFollowUps(current =>
      [...current.filter(item => item.id !== entry.id), entry].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    )
  }

  function applyAutomationLeadState(nextLead: CRMLead) {
    setLead(current =>
      current
        ? {
            ...current,
            automationSettings: nextLead.automationSettings,
            automationStatus: nextLead.automationStatus,
            automationPausedUntil: nextLead.automationPausedUntil,
            automationPauseReason: nextLead.automationPauseReason,
            automationHandoffAt: nextLead.automationHandoffAt,
            automationHandoffReason: nextLead.automationHandoffReason,
            lastAutomationOutboundAt: nextLead.lastAutomationOutboundAt,
            automationLastJobAt: nextLead.automationLastJobAt,
          }
        : nextLead
    )
    setAutomationSettings(resolveAutomationSettings(nextLead.automationSettings))
  }

  async function refreshAutomationState(leadId: string) {
    setAutomationLoading(true)
    try {
      const response = await fetch(`/api/sales/leads/${leadId}/automation`, {
        cache: 'no-store',
        credentials: 'include',
      })

      if (response.status === 403) {
        setAutomationJobs([])
        setAutomationSettings(resolveAutomationSettings(lead?.automationSettings))
        return
      }

      const payload = await response.json() as {
        error?: string
        lead?: CRMLead
        settings?: Required<LeadAutomationSettings>
        jobs?: CRMAutomationJob[]
      }

      if (!response.ok) {
        throw new Error(payload.error || 'Failed to load automation state')
      }

      if (payload.lead) {
        applyAutomationLeadState(payload.lead)
      } else if (payload.settings) {
        setAutomationSettings(resolveAutomationSettings(payload.settings))
      }
      setAutomationJobs(payload.jobs || [])
    } catch (err) {
      setAutomationJobs([])
      setError((err as Error).message)
    } finally {
      setAutomationLoading(false)
    }
  }

  async function updateLeadAutomationSettings(patch: Partial<LeadAutomationSettings>, savingKey: string) {
    if (!lead?.id) return
    setAutomationSavingKey(savingKey)
    try {
      const response = await fetch(`/api/sales/leads/${lead.id}/automation`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: patch }),
      })
      const payload = await response.json() as {
        error?: string
        lead?: CRMLead
        settings?: Required<LeadAutomationSettings>
        jobs?: CRMAutomationJob[]
      }
      if (!response.ok) {
        throw new Error(payload.error || 'Failed to update automation settings')
      }
      if (payload.lead) {
        applyAutomationLeadState(payload.lead)
      } else if (payload.settings) {
        setAutomationSettings(resolveAutomationSettings(payload.settings))
      }
      setAutomationJobs(payload.jobs || [])
      setError(null)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setAutomationSavingKey(null)
    }
  }

  async function cancelLeadAutomationJob(jobId: string) {
    if (!lead?.id) return
    setAutomationSavingKey(jobId)
    try {
      const response = await fetch(`/api/sales/leads/${lead.id}/automation`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'cancel_job', jobId }),
      })
      const payload = await response.json() as {
        error?: string
        lead?: CRMLead
        jobs?: CRMAutomationJob[]
      }
      if (!response.ok) {
        throw new Error(payload.error || 'Failed to cancel scheduled nudge')
      }
      if (payload.lead) {
        applyAutomationLeadState(payload.lead)
      }
      setAutomationJobs(payload.jobs || [])
      setError(null)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setAutomationSavingKey(null)
    }
  }

  async function refresh(currentLeadId: string): Promise<{ quoteId?: string } | null> {
    try {
      const nextLead = await fetchSalesLead(currentLeadId)
      const quotePayload = nextLead?.quoteId ? await fetchSalesQuote(nextLead.quoteId) : null
      setQuote(quotePayload?.quote || null)
      setQuoteDiscountAmount(Number(quotePayload?.quote?.discountAmount || 0))
      setQuoteDiscountLabel(quotePayload?.quote?.discountLabel || '')
      // Restore pricing meta from saved quote so Save Draft doesn't overwrite with defaults
      if (quotePayload?.quote) {
        const q = quotePayload.quote
        pricingMetaRef.current = {
          crewSize: q.crewSize || 3,
          estimatedHours: q.estimatedHours || 3,
          truckCount: q.truckCount || 1,
          estimatedWeightLbs: q.estimatedWeightLbs,
          longDistanceDistanceKm: q.longDistanceDistanceKm,
          longDistanceTruckCost: q.longDistanceTruckCost,
          longDistanceGasCost: q.longDistanceGasCost,
          longDistanceInsuranceCost: q.longDistanceInsuranceCost,
          longDistanceMiscCost: q.longDistanceMiscCost,
          longDistanceMarkupRate: q.longDistanceMarkupRate,
        }
      }
      // Load additional quotes (multi-job leads)
      const extraIds = (nextLead?.quoteIds || []).filter(qid => qid !== nextLead?.quoteId)
      if (extraIds.length > 0) {
        const extras = await Promise.all(
          extraIds.map(qid => fetchSalesQuote(qid).then(r => r?.quote).catch(() => null))
        )
        setAdditionalQuotes(extras.filter(Boolean) as CRMQuote[])
      } else {
        setAdditionalQuotes([])
      }
      const data = await fetchSalesOverview()
      setFollowUps(
        data.followUps.filter(item => {
          if (item.leadId === currentLeadId) {
            return true
          }

          return !!nextLead?.quoteId && item.quoteId === nextLead.quoteId
        })
      )
      if (nextLead) {
        applyLeadSnapshot(nextLead, { hydrateForm: true })
        setAutomationSettings(resolveAutomationSettings(nextLead.automationSettings))
        // Fetch inbound emails from Zoho (stored in email_messages table) for this lead's email
        if (nextLead.email) {
          fetch(`/api/sales/email-messages?email=${encodeURIComponent(nextLead.email)}`)
            .then(r => r.ok ? r.json() : [])
            .then((msgs: typeof emailMessages) => setEmailMessages(msgs))
            .catch(() => {})
        }
        void refreshAutomationState(nextLead.id)
      }
      setError(nextLead ? null : 'Lead not found')
      return nextLead ? { quoteId: nextLead.quoteId } : null
    } catch (err) {
      setError((err as Error).message)
      return null
    }
  }

  useEffect(() => {
    fetchSalesUsers()
      .then(setSalesUsers)
      .catch(() => setSalesUsers([]))
  }, [])

  useEffect(() => {
    if (!params?.id) return
    setLead(null)
    setQuote(null)
    setFollowUps([])
    setAutomationJobs([])
    setAutomationSettings(DEFAULT_AUTOMATION_SETTINGS)
    setError(null)
    void refresh(params.id).then(async (data) => {
      if (estimateIntent) {
        if (data?.quoteId) {
          setQuoteModalOpen(true)
        } else {
          // No quote yet — create one so Save Draft / Preview & Send are enabled
          await createQuote()
        }
      }
    })
  }, [estimateIntent, params?.id])

  useEffect(() => {
    if (!lead || lead.leadKind === 'realtor_opportunity') {
      previousOpportunityLeadIdRef.current = lead?.destinationOpportunityLeadId
      return
    }

    if (lead.destinationOpportunityLeadId && lead.destinationOpportunityLeadId !== previousOpportunityLeadIdRef.current) {
      setOpportunityNotice('Realtor opportunity lead generated from this destination.')
    }

    previousOpportunityLeadIdRef.current = lead.destinationOpportunityLeadId
  }, [lead?.destinationOpportunityLeadId, lead?.leadKind])

  // ── Auto-poll lead every 20s to pick up new calls/SMS in real-time ────────
  useEffect(() => {
    if (!params?.id) return
    const interval = window.setInterval(async () => {
      const nextLead = await fetchSalesLead(params.id!).catch(() => null)
      if (nextLead) {
        setLead(prev => {
          if (!prev) return nextLead
          // Only update call logs (don't overwrite active form edits)
          return { ...prev, callLogs: nextLead.callLogs }
        })
      }
    }, 20_000)
    return () => clearInterval(interval)
  }, [params?.id])

  useEffect(() => {
    if (!params?.id) return

    function handleDialerLeadCallLogged(event: Event) {
      const customEvent = event as CustomEvent<{ leadId?: string; lead?: CRMLead | null }>
      if (!customEvent.detail?.leadId || customEvent.detail.leadId !== params.id || !customEvent.detail.lead) return

      setLead(prev => {
        if (!prev) return customEvent.detail!.lead!
        return {
          ...prev,
          callLogs: customEvent.detail!.lead!.callLogs,
          lastInboundAt: customEvent.detail!.lead!.lastInboundAt,
          lastOutboundAt: customEvent.detail!.lead!.lastOutboundAt,
          lastHumanOutboundAt: customEvent.detail!.lead!.lastHumanOutboundAt,
        }
      })
    }

    window.addEventListener('crm:lead-call-logged', handleDialerLeadCallLogged)
    return () => {
      window.removeEventListener('crm:lead-call-logged', handleDialerLeadCallLogged)
    }
  }, [params?.id])

  // ── Auto-transcribe: fire silently when calls have recording but no transcript ──
  useEffect(() => {
    if (!lead?.id) return
    const needsTranscription = (lead.callLogs || []).some(
      c => c.recordingUrl?.startsWith('https://api.twilio.com/') && !c.transcript
    )
    if (!needsTranscription) return
    // Fire and forget — updates will appear on next poll
    void fetch(`/api/sales/leads/${lead.id}/transcribe-calls`, { method: 'POST', credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then((data: { ok?: boolean; transcribed?: number; lead?: typeof lead } | null) => {
        if (data?.transcribed && data.lead) {
          setLead(prev => prev ? { ...prev, callLogs: data.lead!.callLogs } : data.lead!)
        }
      })
      .catch(() => null)
  // Count calls that have a recording but no transcript — changes when sync-calls patches a recording in
  }, [lead?.id, (lead?.callLogs || []).filter((c: any) => c.recordingUrl?.startsWith('https://api.twilio.com/') && !c.transcript).length])

  // ── Auto-sync calls: pull any unmapped Twilio calls for this lead's number ──
  useEffect(() => {
    if (!lead?.id || !lead?.phone) return
    void fetch(`/api/sales/leads/${lead.id}/sync-calls`, { method: 'POST', credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then((data: { ok?: boolean; synced?: number; lead?: typeof lead } | null) => {
        if (data?.synced && data.lead) {
          setLead(prev => prev ? { ...prev, callLogs: data.lead!.callLogs } : data.lead!)
        }
      })
      .catch(() => null)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lead?.id])

  useEffect(() => {
    if (!lead?.supabaseListing?.address) return
    if ((lead.inventory || []).length > 0) return

    const leadId = lead.id
    const listingAddress = lead.supabaseListing.address

    let cancelled = false

    const storedPhotoCount = (lead.supabaseListing?.carouselphotos || []).length

    async function hydrateInventoryFromListing() {
      try {
        setInventoryLoading(true)
        const result = await enrichSalesAddress(listingAddress, false)
        if (cancelled) return

        const updates: Partial<import('@/lib/types').CRMLead> = {}

        // Refresh supabaseListing if fresh listing has photos but stored one doesn't
        if (result.listing && (result.listing.carouselphotos || []).length > storedPhotoCount) {
          updates.supabaseListing = result.listing
        }

        if (result.scan) {
          const nextInventory = result.scan.inventory || []
          const nextMetrics = deriveInventoryMetrics(nextInventory)
          setInventory(nextInventory)
          updates.inventory = nextMetrics.inventory
          updates.totalItems = nextMetrics.totalItems
          updates.totalCubicFeet = nextMetrics.totalCubicFeet
          updates.totalWeightLbs = nextMetrics.totalWeightLbs
          updates.roomBreakdown = buildRoomBreakdown(nextMetrics.inventory)
        }

        if (Object.keys(updates).length > 0) {
          const saved = await updateSalesLead(leadId, updates)
          if (!cancelled) setLead(saved)
        }
      } catch (err) {
        if (!cancelled) {
          setError((err as Error).message)
        }
      } finally {
        if (!cancelled) {
          setInventoryLoading(false)
        }
      }
    }

    void hydrateInventoryFromListing()

    return () => {
      cancelled = true
    }
  }, [lead?.id, lead?.inventory, lead?.supabaseListing?.address])

  const listingPhotos = useMemo(
    () =>
      (lead?.supabaseListing?.carouselphotos || [])
        .map(photo => (typeof photo === 'string' ? photo : photo?.url))
        .filter((value): value is string => !!value),
    [lead?.supabaseListing?.carouselphotos]
  )

  useEffect(() => {
    if (!analysisBusy || listingPhotos.length <= 1) return
    const timer = window.setInterval(() => {
      setActivePhotoIndex(current => (current + 1) % listingPhotos.length)
    }, 1200)

    return () => window.clearInterval(timer)
  }, [analysisBusy, listingPhotos.length])

  useEffect(() => {
    if (activePhotoIndex >= listingPhotos.length) {
      setActivePhotoIndex(0)
    }
  }, [activePhotoIndex, listingPhotos.length])

  const timeline = useMemo(() => {
    const systemEvents = [
      quote ? { id: `quote-created-${quote.id}`, kind: 'quote draft', text: `${quote.number} created as draft.`, date: quote.createdAt, actor: 'system', amount: quote.total, quoteId: quote.id } : null,
      quote?.sentAt ? { id: `quote-sent-${quote.id}`, kind: 'quote sent', text: `${quote.number} sent to customer for review.`, date: quote.sentAt, actor: 'rep', amount: quote.total, quoteId: quote.id } : null,
      quote?.viewedAt ? { id: `quote-viewed-${quote.id}`, kind: 'quote viewed', text: `${quote.number} opened by customer.`, date: quote.viewedAt, actor: 'customer', amount: quote.total, quoteId: quote.id } : null,
      quote?.acceptedAt ? { id: `quote-accepted-${quote.id}`, kind: 'quote accepted', text: `${quote.number} accepted by customer.`, date: quote.acceptedAt, actor: 'customer', amount: quote.total, quoteId: quote.id } : null,
      quote?.status === 'declined' && quote?.respondedAt
        ? { id: `quote-declined-${quote.id}`, kind: 'quote declined', text: `${quote.number} declined by customer.`, date: quote.respondedAt, actor: 'customer', amount: quote.total, quoteId: quote.id }
        : null,
    ].filter(Boolean) as Array<{ id: string; kind: string; text: string; date: string; actor?: string; amount?: number; quoteId?: string }>

    const logs = [...(lead?.callLogs || [])].map(item => {
      const isInboundCall = item.type === 'call' && (item.notes || '').toLowerCase().includes('inbound')
      const hasEnrichment = !!(item.recordingUrl || item.recordingSid || item.transcript || item.aiSummary)
      const isVm = item.isVoicemail || (item.transcript || '').startsWith('[Voicemail]')
      const branchLabel = getSaturnBranchLabel(item.branchNumber)
      const text =
        item.type === 'call' && isVm
          ? `Went to voicemail${item.duration ? ` — ${item.duration}` : ''}.${item.transcript ? ' Recording transcribed.' : (item.recordingUrl || item.recordingSid) ? ' Recording processing…' : ''}`
          : item.type === 'call' && isInboundCall && hasEnrichment
            ? `Inbound call completed${item.duration ? ` — ${item.duration}` : ''}.`
            : item.type === 'consultation' && (item.recordingUrl || item.recordingSid) && !item.transcript && !item.aiSummary
              ? 'In-house consultation recorded. Click to retry transcription.'
              : item.notes || item.type

      return {
        id: item.id,
        kind: item.type,
        text,
        date: item.date,
        actor: item.source === 'consultation' ? 'rep' : item.type === 'call' ? 'rep' : 'system',
        recordingUrl: item.recordingUrl,
        recordingSid: item.recordingSid,
        recordingUnavailable: item.recordingUnavailable,
        recordingUnavailableReason: item.recordingUnavailableReason,
        transcript: item.transcript,
        aiSummary: item.aiSummary,
        duration: item.duration,
        phone: item.phone,
        branchLabel: branchLabel || undefined,
        branchNumber: item.branchNumber,
        isVoicemail: isVm || undefined,
        callSid: (item as any).callSid || undefined,
        repName: (item as any).repName || undefined,
      }
    })

    const fu = followUps.map(item => ({
      id: item.id,
      kind: item.type,
      text: item.notes || 'Follow-up logged',
      date: item.date,
      actor: 'rep',
      aiSummary: item.aiSummary,
    }))

    // Merge inbound emails from Zoho (email_messages table) — these won't be in followUps
    const inboundEmails = emailMessages
      .filter(m => m.direction === 'inbound')
      .map(m => ({
        id: m.id,
        kind: 'email' as const,
        text: m.body || m.subject || '(no body)',
        emailSubject: m.subject || undefined,
        date: m.sentAt,
        actor: 'customer' as const,
      }))

    return [...systemEvents, ...logs, ...fu, ...inboundEmails].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
  }, [followUps, lead, quote, emailMessages])
  const latestCallInsight = useMemo(() => {
    const callLogs = lead?.callLogs || []
    return callLogs.find(item => item.aiSummary || item.transcript || item.recordingUrl || item.recordingSid) || null
  }, [lead?.callLogs])

  const aiNudge = useMemo(() => {
    if (!lead) return null
    const now = Date.now()
    const dayMs = 86400000

    // Follow-up date overdue
    if (lead.followUpDate) {
      const due = new Date(lead.followUpDate).getTime()
      const daysOver = Math.floor((now - due) / dayMs)
      if (daysOver > 0) return { urgency: 'high', icon: '⚠️', text: `Follow-up was due ${daysOver === 1 ? 'yesterday' : `${daysOver} days ago`}`, action: 'Reach out now' }
      if (daysOver === 0) return { urgency: 'high', icon: '📅', text: 'Follow-up is due today', action: 'Reach out today' }
    }

    // Quote sent but not viewed in 3+ days
    if (quote?.sentAt && !quote.viewedAt) {
      const daysSinceSent = Math.floor((now - new Date(quote.sentAt).getTime()) / dayMs)
      if (daysSinceSent >= 3) return { urgency: 'medium', icon: '👀', text: `Quote sent ${daysSinceSent} days ago — not opened yet`, action: 'Send a quick nudge' }
    }

    // Quote viewed but no response in 2+ days
    if (quote?.viewedAt && quote.status === 'sent') {
      const daysSinceViewed = Math.floor((now - new Date(quote.viewedAt).getTime()) / dayMs)
      if (daysSinceViewed >= 2) return { urgency: 'medium', icon: '⏳', text: `Quote viewed ${daysSinceViewed} days ago — no response`, action: 'Check in on their decision' }
    }

    // AI-suggested next action from last call
    if (latestCallInsight?.aiSummary?.nextAction) {
      const callDate = latestCallInsight.date ? new Date(latestCallInsight.date).getTime() : 0
      const daysSinceCall = Math.floor((now - callDate) / dayMs)
      const followUpDays = latestCallInsight.aiSummary.followUpDays || 2
      if (daysSinceCall >= followUpDays) {
        return { urgency: 'medium', icon: '💡', text: latestCallInsight.aiSummary.nextAction, action: latestCallInsight.aiSummary.followUpReason || `${daysSinceCall} days since last call` }
      }
    }

    // No contact in 7+ days for active leads
    if (!isClosedLeadStage(lead.stage)) {
      const allDates = [
        ...followUps.map(f => f.date),
        ...(lead.callLogs || []).map(c => c.date),
        lead.createdAt,
      ].filter(Boolean).map(d => new Date(d).getTime())
      const lastContact = Math.max(...allDates)
      const daysSince = Math.floor((now - lastContact) / dayMs)
      if (daysSince >= 7) return { urgency: 'low', icon: '💤', text: `No contact in ${daysSince} days`, action: 'Time to check in' }
    }

    return null
  }, [lead, quote, latestCallInsight, followUps])
  const quoteEngagement = useMemo(() => {
    if (!quote) {
      return [
        { label: 'No quote yet', value: 'Build the first estimate', complete: false },
      ]
    }

    return [
      { label: 'Draft built', value: formatDateTime(quote.createdAt), complete: true },
      { label: 'Sent', value: quote.sentAt ? formatDateTime(quote.sentAt) : 'Not sent yet', complete: !!quote.sentAt },
      { label: 'Viewed', value: quote.viewedAt ? formatDateTime(quote.viewedAt) : 'Not viewed yet', complete: !!quote.viewedAt },
      {
        label: quote.status === 'accepted' ? 'Accepted' : quote.status === 'declined' ? 'Declined' : 'Awaiting response',
        value:
          quote.status === 'accepted'
            ? formatDateTime(quote.acceptedAt || quote.respondedAt || quote.createdAt)
            : quote.status === 'declined'
              ? formatDateTime(quote.respondedAt || quote.createdAt)
              : 'Pending customer response',
        complete: quote.status === 'accepted' || quote.status === 'declined',
      },
    ]
  }, [quote])
  const leadGuidance = useMemo(() => {
    if (!lead) return null
    return getLeadGuidance(lead, quote, followUps)
  }, [followUps, lead, quote])

  useEffect(() => {
    if (!consultationActive) return
    const timer = window.setInterval(() => {
      setConsultationSeconds(current => current + 1)
    }, 1000)
    return () => window.clearInterval(timer)
  }, [consultationActive])

  const inventoryMetrics = useMemo(() => deriveInventoryMetrics(inventory), [inventory])
  const savedLeadSignature = useMemo(() => {
    if (!lead) return null
    return buildLeadSignature({
      name: lead.name || '',
      phone: lead.phone || '',
      email: lead.email || '',
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
  }, [lead])
  const draftLeadSignature = useMemo(() => {
    if (!lead) return null
    return buildLeadSignature({
      name: leadName,
      phone: leadPhone,
      email: leadEmail,
      moveDate,
      moveDateFlexible,
      moveDateFlexibleReason,
      moveType: moveType || '',
      branch: branch || '',
      source: leadSource,
      originAddress,
      originCity,
      originAccess,
      destAddress,
      destCity,
      destAccess,
      parkingNotes,
      realtorBrokerage,
      moveReason,
      notes,
      stage,
      contextFlag,
      followUpDate,
      assignedRepName: assignedRep,
      assignedRepUserId,
      estimateDate,
      estimateTime,
      lostReason,
      lostNotes,
      jobFactors,
      inventory: inventoryMetrics.inventory,
    })
  }, [
    assignedRep,
    assignedRepUserId,
    branch,
    contextFlag,
    destAccess,
    destAddress,
    destCity,
    estimateDate,
    estimateTime,
    followUpDate,
    inventoryMetrics.inventory,
    jobFactors,
    lead,
    leadEmail,
    leadName,
    leadPhone,
    leadSource,
    lostNotes,
    lostReason,
    moveDate,
    moveDateFlexible,
    moveDateFlexibleReason,
    moveReason,
    moveType,
    notes,
    originAccess,
    originAddress,
    originCity,
    parkingNotes,
    realtorBrokerage,
    stage,
  ])
  const hasUnsavedChanges = useMemo(() => {
    if (!canEditCurrentLead || !lead || !savedLeadSignature || !draftLeadSignature) return false
    return savedLeadSignature !== draftLeadSignature
  }, [canEditCurrentLead, draftLeadSignature, lead, savedLeadSignature])
  const quoteModalTotals = useMemo(() => {
    const depositRate = quote && quote.total > 0 ? quote.deposit / quote.total : 0.2
    return computeQuoteTotals(quoteLineItems, depositRate, quoteDiscountAmount)
  }, [quote, quoteDiscountAmount, quoteLineItems])
  const groupedInventory = useMemo(() => {
    const groups = new Map<string, Array<{ item: InventoryItem; index: number }>>()
    inventory.forEach((item, index) => {
      const room = normalizeRoomName(item.room)
      const existing = groups.get(room) || []
      existing.push({ item, index })
      groups.set(room, existing)
    })
    return Array.from(groups.entries()).sort((a, b) => a[0].localeCompare(b[0]))
  }, [inventory])
  const presetMatches = useMemo(() => {
    const term = presetSearch.trim().toLowerCase()
    if (!term) return INVENTORY_PRESETS.slice(0, 8)
    return INVENTORY_PRESETS.filter(preset => preset.label.toLowerCase().includes(term)).slice(0, 8)
  }, [presetSearch])

  useEffect(() => {
    if (!hasUnsavedChanges) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (window as any).__onNavAttempt
      return
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(window as any).__onNavAttempt = (href: string) => {
      pendingLeaveActionRef.current = href
      setShowUnsavedLeaveModal(true)
    }

    function handleBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault()
      event.returnValue = ''
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (window as any).__onNavAttempt
    }
  }, [hasUnsavedChanges])

  useEffect(() => {
    if (!lead?.id || !hasUnsavedChanges || historyGuardArmedRef.current) return
    window.history.pushState({ leadLeaveGuard: lead.id }, '', window.location.href)
    historyGuardArmedRef.current = true
  }, [hasUnsavedChanges, lead?.id])

  useEffect(() => {
    function handlePopState() {
      if (bypassLeaveGuardRef.current) {
        bypassLeaveGuardRef.current = false
        return
      }

      if (historyGuardArmedRef.current && !hasUnsavedChanges) {
        bypassLeaveGuardRef.current = true
        window.history.back()
        return
      }

      if (!hasUnsavedChanges) return

      pendingLeaveActionRef.current = 'history-back'
      setShowUnsavedLeaveModal(true)
      window.history.pushState({ leadLeaveGuard: lead?.id || 'lead' }, '', window.location.href)
    }

    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [hasUnsavedChanges, lead?.id])

  function continuePendingLeave() {
    const pendingLeaveAction = pendingLeaveActionRef.current
    pendingLeaveActionRef.current = null
    setShowUnsavedLeaveModal(false)
    setUnsavedLeaveBusy(false)
    bypassLeaveGuardRef.current = true

    // Nav-link intercept: any string that's a URL path
    if (pendingLeaveAction && pendingLeaveAction !== 'history-back') {
      router.push(pendingLeaveAction)
      return
    }

    if (pendingLeaveAction === 'history-back') {
      if (historyGuardArmedRef.current) {
        window.history.go(-2)
        return
      }
      if (window.history.length > 1) {
        router.back()
        return
      }
    }

    router.push('/sales/leads')
  }

  function handleBackNavigation() {
    if (!hasUnsavedChanges) {
      if (window.history.length > 1) {
        router.back()
        return
      }
      router.push('/sales/leads')
      return
    }

    pendingLeaveActionRef.current = 'history-back'
    setShowUnsavedLeaveModal(true)
  }

  async function handleSaveAndLeave() {
    setUnsavedLeaveBusy(true)
    const saved = await saveLead()
    if (!saved) {
      setUnsavedLeaveBusy(false)
      setShowUnsavedLeaveModal(false)
      pendingLeaveActionRef.current = null
      return
    }
    continuePendingLeave()
  }

  function handleDiscardAndLeave() {
    continuePendingLeave()
  }

  function handleStayOnLead() {
    pendingLeaveActionRef.current = null
    setShowUnsavedLeaveModal(false)
    setUnsavedLeaveBusy(false)
  }

  async function handleLeadCommandAction(action: string) {
    if (!lead) return

    if (action === 'call_now' || action === 'call_back') {
      const targetPhone =
        lead.primaryContactRole === 'realtor'
          ? lead.realtorPhone || lead.phone
          : lead.phone

      if (targetPhone) {
        window.dispatchEvent(new CustomEvent('crm:open-dialer', { detail: { phone: targetPhone, leadId: lead.id, name: lead.name } }))
      }
      return
    }

    if (action === 'send_sms' || action === 'reply_now') {
      setActiveTab('sms')
      return
    }

    if (action === 'send_deposit_sms') {
      await sendDepositLink()
      return
    }

    if (action === 'open_quote' || action === 'send_quote') {
      if (quote?.id && (quote.sentAt || quote.viewedAt || quote.acceptedAt)) {
        router.push(`/sales/quotes/${quote.id}`)
        return
      }
      await openQuoteBuilder()
      return
    }

    if (action === 'assign_to_me' && currentUser?.userId) {
      const updated = await updateSalesLead(lead.id, {
        assignedRep: currentUser.name || undefined,
        assignedRepName: currentUser.name || undefined,
        assignedRepUserId: currentUser.userId,
      })
      applyLeadSnapshot(updated, { hydrateForm: true })
      return
    }

    if (action === 'collect_deposit') {
      if (quote) {
        setCollectCardOpen(true)
      }
      return
    }

    if (action === 'confirm_move_date') {
      setActiveTab('timeline')
      return
    }

    if (action === 'mark_lost') {
      setPendingStage('lost')
      setShowLostModal(true)
      return
    }

    if (action === 'snooze') {
      const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)
      setFollowUpDate(tomorrow)
      return
    }
  }

  function buildLeadDraftPayload() {
    return {
      name: leadName,
      phone: leadPhone || undefined,
      email: leadEmail || undefined,
      moveDate: moveDate || undefined,
      moveDateFlexible: moveDateFlexible || undefined,
      moveDateFlexibleReason: moveDateFlexibleReason || undefined,
      moveType: moveType || undefined,
      branch: branch || undefined,
      source: leadSource || undefined,
      originAddress: originAddress || undefined,
      originCity: originCity || undefined,
      originAccess: originAccess || undefined,
      destAddress: destAddress || undefined,
      destCity: destCity || undefined,
      destAccess: destAccess || undefined,
      parkingNotes: parkingNotes || undefined,
      stage,
      followUpDate: followUpDate || undefined,
      realtorName: lead?.leadKind === 'realtor_opportunity' && lead?.primaryContactRole !== 'customer' ? (leadName || undefined) : lead?.realtorName,
      realtorPhone: lead?.leadKind === 'realtor_opportunity' && lead?.primaryContactRole !== 'customer' ? (leadPhone || undefined) : lead?.realtorPhone,
      realtorEmail: lead?.leadKind === 'realtor_opportunity' && lead?.primaryContactRole !== 'customer' ? (leadEmail || undefined) : lead?.realtorEmail,
      realtorBrokerage: realtorBrokerage || undefined,
      moveReason,
      notes,
      inventory: inventoryMetrics.inventory,
      totalItems: inventoryMetrics.totalItems,
      totalCubicFeet: inventoryMetrics.totalCubicFeet,
      totalWeightLbs: inventoryMetrics.totalWeightLbs,
      roomBreakdown: buildRoomBreakdown(inventoryMetrics.inventory),
      jobFactors: Object.keys(jobFactors).length > 0 ? jobFactors : undefined,
      contextFlag: contextFlag || undefined,
      // Only include assignment fields when they carry a real value.
      // Sending empty strings for unassigned leads triggers the reassign
      // permission check and blocks saves for sales reps.
      ...(assignedRep ? { assignedRep, assignedRepName: assignedRep } : {}),
      ...(assignedRepUserId ? { assignedRepUserId } : {}),
      estimateDate: estimateDate || undefined,
      estimateTime: estimateTime || undefined,
      lostReason: lostReason || undefined,
      lostNotes: lostNotes || undefined,
    }
  }

  function recalculateEstimate(options?: {
    quoteType?: 'standard' | 'labor_only' | 'packing_only' | 'long_distance' | 'storage'
    distanceKm?: number
    routeContext?: EstimateRouteContext
  }) {
    if (!lead) return
    setRecalculateBusy(true)
    try {
      const snapshot: CRMLead = {
        ...lead,
        inventory,
        totalCubicFeet: inventoryMetrics.totalCubicFeet,
        totalWeightLbs: inventoryMetrics.totalWeightLbs,
        moveType,
        quoteType: options?.quoteType,
      }
      const estimate = estimateLeadQuote(snapshot, {
        quoteType: options?.quoteType,
        distanceKm: options?.distanceKm,
        routeContext: options?.routeContext,
      }, jobFactors)
      setQuoteLineItems(estimate.lineItems)
      setQuoteModalDirty(true)
      pricingMetaRef.current = {
        crewSize: estimate.crewSize || 3,
        estimatedHours: estimate.estimatedHours || 3,
        truckCount: estimate.truckCount || 1,
        estimatedWeightLbs: estimate.estimatedWeightLbs || undefined,
        longDistanceDistanceKm: estimate.longDistanceDistanceKm || undefined,
        longDistanceTruckCost: estimate.longDistanceTruckCost || undefined,
        longDistanceGasCost: estimate.longDistanceGasCost || undefined,
        longDistanceInsuranceCost: estimate.longDistanceInsuranceCost || undefined,
        longDistanceMiscCost: estimate.longDistanceMiscCost || undefined,
        longDistanceMarkupRate: estimate.longDistanceMarkupRate || undefined,
      }
    } finally {
      setRecalculateBusy(false)
    }
  }

  const handleModalRecalculate = useCallback((options?: {
    quoteType?: 'standard' | 'labor_only' | 'packing_only' | 'long_distance' | 'storage'
    distanceKm?: number
    routeContext?: EstimateRouteContext
  }) => {
    recalculateEstimate(options)
  }, [lead, inventory, inventoryMetrics.totalCubicFeet, inventoryMetrics.totalWeightLbs, moveType, jobFactors])

  // Re-derive line items whenever inventory or job factors change while the modal is open
  // This keeps Draft Summary in sync with the live breakdown whenever factors are toggled
  useEffect(() => {
    if (!quoteModalOpen || !lead) return
    recalculateEstimate()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inventoryMetrics.totalCubicFeet, inventoryMetrics.totalWeightLbs, quoteModalOpen, jobFactors])

  async function saveLead(options?: { skipLostCheck?: boolean; pendingStageName?: CRMLead['stage'] }) {
    if (!lead) return false
    if (!ensureLeadEditable()) return false

    // Intercept: moving to 'lost' requires a reason first
    const targetStage = options?.pendingStageName ?? stage
    if (targetStage === 'lost' && lead.stage !== 'lost' && !options?.skipLostCheck) {
      setPendingStage(targetStage)
      setShowLostModal(true)
      return false
    }

    const prevStage = lead.stage
    const stageChanged = targetStage !== prevStage

    // Intercept: moving to 'estimate_scheduled' — ask rep if they want to auto-send SMS
    if (targetStage === 'estimate_scheduled' && prevStage !== 'estimate_scheduled' && lead.phone && !options?.skipLostCheck) {
      const draftPayload = { ...buildLeadDraftPayload(), stage: targetStage }
      setApptSmsPendingPayload(draftPayload)
      setShowApptSmsModal(true)
      return false
    }

    if (targetStage === 'booked' && prevStage !== 'booked') {
      if (!quote) {
        setError('Create and send a quote before moving this lead to Booked.')
        setStage(prevStage)
        return false
      }
      openConfirmJobModal()
      return false
    }

    // Skip the confirm dialog when coming from a dedicated modal (e.g. lost modal already
    // got explicit confirmation from the rep — a second window.confirm is confusing and
    // causes reps to cancel the save accidentally).
    if (
      stageChanged &&
      !options?.skipLostCheck &&
      !window.confirm(`Save this lead and move it from ${prevStage.replace(/_/g, ' ')} to ${targetStage.replace(/_/g, ' ')}?`)
    ) {
      setStage(prevStage)
      return false
    }

    try {
      setSaving(true)
      const payload = { ...buildLeadDraftPayload(), stage: targetStage }
      if (targetStage === 'lost' && !payload.lostReason) {
        payload.lostReason = lostReason || undefined
        payload.lostNotes = lostNotes || undefined
      }
      const saved = await updateSalesLead(lead.id, payload)
      applyLeadSnapshot(saved, { hydrateForm: true })

      // Log stage change to timeline automatically
      if (stageChanged) {
        const prevLabel = SALES_LEAD_STAGES.find(s => s.id === prevStage)?.label || prevStage
        const nextLabel = SALES_LEAD_STAGES.find(s => s.id === targetStage)?.label || targetStage
        const lostNote = targetStage === 'lost' && lostReason
          ? ` Reason: ${LOST_REASONS.find(r => r.id === lostReason)?.label || lostReason}.`
          : ''
        await saveSalesFollowUp({
          leadId: lead.id,
          type: 'status_change',
          notes: `Stage: ${prevLabel} → ${nextLabel}.${lostNote}`,
          date: new Date().toISOString(),
        }).catch(() => {})
        void refresh(lead.id)
      }

      setError(null)
      return true
    } catch (err) {
      setError((err as Error).message)
      return false
    } finally {
      setSaving(false)
    }
  }

  async function handleConfirmLost() {
    if (!lostReason) return
    setShowLostModal(false)
    const target = pendingStage || 'lost'
    setPendingStage(null)
    await saveLead({ skipLostCheck: true, pendingStageName: target })
  }

  async function handleApptSmsConfirm(sendSms: boolean) {
    if (!lead || !apptSmsPendingPayload) return
    setShowApptSmsModal(false)
    const payload = apptSmsPendingPayload
    setApptSmsPendingPayload(null)
    try {
      setSaving(true)
      const saved = await updateSalesLead(lead.id, { ...payload, ...(sendSms ? { sendAppointmentSms: true } : {}) } as Parameters<typeof updateSalesLead>[1])
      applyLeadSnapshot(saved, { hydrateForm: true })
      const prevLabel = SALES_LEAD_STAGES.find(s => s.id === lead.stage)?.label || lead.stage
      const nextLabel = SALES_LEAD_STAGES.find(s => s.id === 'estimate_scheduled')?.label || 'Estimate Scheduled'
      await saveSalesFollowUp({ leadId: lead.id, type: 'status_change', notes: `Stage: ${prevLabel} → ${nextLabel}.`, date: new Date().toISOString() }).catch(() => {})
      void refresh(lead.id)
      setError(null)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  async function handleBookConsultation(data: {
    estimateDate: string
    estimateTime: string
    consultationTriggerReason: string
    consultationAssignedManagerName: string
    consultationAssignedManagerId: string
    consultationCustomerConcern: string
    consultationPreVisitBrief: string
    sendSms: boolean
  }) {
    if (!lead) return
    setShowConsultationModal(false)
    try {
      setSaving(true)
      const saved = await updateSalesLead(lead.id, {
        stage: 'estimate_scheduled',
        estimateDate: data.estimateDate,
        estimateTime: data.estimateTime,
        consultationTriggerReason: data.consultationTriggerReason,
        consultationAssignedManagerName: data.consultationAssignedManagerName,
        consultationAssignedManagerId: data.consultationAssignedManagerId,
        consultationCustomerConcern: data.consultationCustomerConcern,
        consultationPreVisitBrief: data.consultationPreVisitBrief,
        consultationStatus: 'booked',
        consultationBookedAt: new Date().toISOString(),
        ...(data.sendSms ? { sendAppointmentSms: true } : {}),
      } as Parameters<typeof updateSalesLead>[1])
      applyLeadSnapshot(saved, { hydrateForm: true })
      await saveSalesFollowUp({
        leadId: lead.id,
        type: 'visit',
        notes: `In-Home Move Consultation booked for ${data.estimateDate}${data.estimateTime ? ` at ${data.estimateTime}` : ''}${data.consultationAssignedManagerName ? ` — ${data.consultationAssignedManagerName}` : ''}.`,
        date: new Date().toISOString(),
      }).catch(() => {})
      void refresh(lead.id)
      setError(null)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  async function handleConfirmJob() {
    if (!lead) return
    if (!ensureLeadEditable()) return
    try {
      setConfirmJobBusy(true)
      const saved = await confirmJob(lead.id, {
        depositAmount: confirmJobDeposit ? Number(confirmJobDeposit) : undefined,
        depositMethod: confirmJobDepositMethod || undefined,
        sendConfirmation: true,
      })
      applyLeadSnapshot(saved, { hydrateForm: true })
      setShowConfirmJobModal(false)
      void refresh(lead.id)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setConfirmJobBusy(false)
    }
  }

  function openConfirmJobModal() {
    setConfirmJobDeposit(
      lead?.paymentStatus === 'deposit_received' || lead?.paymentStatus === 'paid_in_full'
        ? ''
        : quote?.deposit
          ? String(quote.deposit)
          : ''
    )
    setConfirmJobDepositMethod(lead?.depositMethod || 'E-Transfer')
    setShowConfirmJobModal(true)
  }

  function closeConfirmJobModal() {
    setShowConfirmJobModal(false)
    setConfirmJobDeposit('')
    setConfirmJobDepositMethod(lead?.depositMethod || 'E-Transfer')
    setStage(lead?.stage || 'new')
  }

  async function createQuote(asAdditionalJob = false) {
    if (!lead) return
    if (!ensureLeadEditable()) return
    try {
      setCreatingQuote(true)
      const result = await createLeadQuote(lead.id)
      setLead(result.lead)
      if (asAdditionalJob) {
        // Adding a new job to an existing lead — track it in additionalQuotes and open it in the builder
        setAdditionalQuotes(prev => [result.quote, ...prev.filter(q => q.id !== result.quote.id)])
      }
      // Open the new quote in the builder regardless
      setQuote(result.quote)
      setQuoteLineItems(result.quote.lineItems || [])
      setQuoteDiscountAmount(Number(result.quote.discountAmount || 0))
      setQuoteDiscountLabel(result.quote.discountLabel || '')
      setQuoteMoveDescription(result.quote.moveDescription || '')
      setQuoteInternalNotes(result.quote.internalNotes || '')
      setQuoteModalDirty(false)
      setQuoteModalOpen(true)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setCreatingQuote(false)
    }
  }

  async function requestPhotoSurvey() {
    if (!lead) return
    if (!ensureLeadEditable()) return
    setSurveyBusy(true)
    try {
      // Generate link first (skipSms=true) — we'll show a dialog to let rep review before sending
      const res = await fetch(`/api/sales/leads/${lead.id}/survey`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skipSms: true }),
      })
      const data = await res.json() as { surveyUrl?: string; defaultSmsTemplate?: string | null; token?: string; error?: string }
      if (!res.ok || data.error) throw new Error(data.error || 'Failed to generate survey link')
      const newSurveyUrl = data.surveyUrl || null
      setSurveyUrl(newSurveyUrl)
      setLead(prev => prev ? { ...prev, surveyToken: 'set', surveyRequestedAt: new Date().toISOString() } as typeof prev : prev)

      if (lead.phone && newSurveyUrl) {
        // Show the dialog so rep can review/edit the SMS before sending
        setPhotoRequestData({ surveyUrl: newSurveyUrl, draftSms: data.defaultSmsTemplate || '', token: data.token || '' })
        setPhotoRequestSmsBody(data.defaultSmsTemplate || '')
        setShowPhotoRequestDialog(true)
      }
    } catch (err) {
      alert('Could not generate survey link. Please try again.')
      console.error(err)
    } finally {
      setSurveyBusy(false)
    }
  }

  async function sendPhotoRequestSms() {
    if (!lead || !photoRequestData) return
    setPhotoRequestSending(true)
    try {
      const phone = lead.phone!.replace(/\D/g, '')
      const e164 = phone.startsWith('1') ? `+${phone}` : `+1${phone}`
      await fetch('/api/sales/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ channel: 'sms', to: e164, body: photoRequestSmsBody, leadId: lead.id, notes: 'Photo survey request' }),
      })
      setSmsMessages(prev => [...prev, {
        id: `survey_${Date.now()}`,
        from_number: getDefaultSaturnBranchNumber(),
        to_number: e164,
        body: photoRequestSmsBody,
        direction: 'outbound' as const,
        lead_id: lead.id ?? null,
        created_at: new Date().toISOString(),
      }])
      setActiveTab('sms')
      setShowPhotoRequestDialog(false)
      setTimeout(() => { if (smsAreaRef.current) smsAreaRef.current.scrollTop = smsAreaRef.current.scrollHeight }, 60)
    } catch { /* ignore */ } finally { setPhotoRequestSending(false) }
  }

  async function generateDispatchBrief() {
    if (!lead) return
    setDispatchBriefBusy(true)
    setDispatchBriefOpen(true)
    try {
      const res = await fetch(`/api/sales/leads/${lead.id}/dispatch-brief`, { method: 'POST', credentials: 'include' })
      const data = await res.json() as { brief?: string; error?: string }
      setDispatchBriefText(data.brief || 'Could not generate brief.')
    } catch { setDispatchBriefText('Error generating brief.') }
    finally { setDispatchBriefBusy(false) }
  }

  async function handleRepMediaUpload() {
    if (!lead || mediaUploadFiles.length === 0) return
    if (!ensureLeadEditable()) return
    setMediaUploadBusy(true)
    setMediaUploadNotice(null)
    try {
      const result = await uploadLeadMedia(lead.id, {
        room: normalizeRoomName(mediaUploadRoom),
        files: mediaUploadFiles,
      })
      applyLeadSnapshot(result.lead, { hydrateForm: true })
      setMediaUploadFiles([])
      if (mediaUploadInputRef.current) {
        mediaUploadInputRef.current.value = ''
      }
      setMediaUploadNotice(
        `Uploaded ${result.uploadedCount} file${result.uploadedCount === 1 ? '' : 's'} · scanned ${result.analyzedImageCount} image${result.analyzedImageCount === 1 ? '' : 's'} · detected ${result.detectedItems.length} inventory item${result.detectedItems.length === 1 ? '' : 's'}${result.skippedVideoCount ? ` · stored ${result.skippedVideoCount} video${result.skippedVideoCount === 1 ? '' : 's'} for manual review` : ''}.`
      )
    } catch (err) {
      setMediaUploadNotice((err as Error).message)
    } finally {
      setMediaUploadBusy(false)
    }
  }

  async function openQuoteBuilder() {
    if (!lead) return
    if (!ensureLeadEditable()) return
    if (!quote) {
      await createQuote()
      return
    }
    setQuoteLineItems(quote.lineItems || [])
    setQuoteDiscountAmount(Number(quote.discountAmount || 0))
    setQuoteDiscountLabel(quote.discountLabel || '')
    setQuoteMoveDescription(quote.moveDescription || '')
    setQuoteInternalNotes(quote.internalNotes || '')
    setQuoteModalDirty(false)
    setQuoteModalOpen(true)
  }

  function updateQuoteLineItem(index: number, field: keyof QuoteLineItem, value: string) {
    setQuoteLineItems(current =>
      current.map((item, itemIndex) =>
        itemIndex === index
          ? {
              ...item,
              [field]: field === 'amount' ? Number(value || 0) : value,
            }
          : item
      )
    )
    setQuoteModalDirty(true)
  }

  function addQuoteLineItem() {
    setQuoteLineItems(current => [...current, { description: '', details: '', amount: 0 }])
    setQuoteModalDirty(true)
  }

  function removeQuoteLineItem(index: number) {
    setQuoteLineItems(current => current.filter((_, itemIndex) => itemIndex !== index))
    setQuoteModalDirty(true)
  }

  async function saveQuoteDraft(overrides?: { moveDescription?: string; internalNotes?: string }) {
    if (!quote) return
    if (!ensureLeadEditable()) return
    try {
      setQuoteModalBusy(true)
      const nextMoveDescription = overrides?.moveDescription ?? quoteMoveDescription
      const nextInternalNotes = overrides?.internalNotes ?? quoteInternalNotes
      const depositRate = quote.total > 0 ? quote.deposit / quote.total : 0.2
      const totals = computeQuoteTotals(quoteLineItems, depositRate, quoteDiscountAmount)
      const result = await updateSalesQuote(quote.id, {
        lineItems: totals.lineItems,
        discountAmount: quoteDiscountAmount,
        discountLabel: quoteDiscountLabel || undefined,
        subtotal: totals.subtotal,
        hst: totals.hst,
        total: totals.total,
        deposit: totals.deposit,
        balance: totals.balance,
        crewSize: pricingMetaRef.current.crewSize,
        estimatedHours: pricingMetaRef.current.estimatedHours,
        truckCount: pricingMetaRef.current.truckCount,
        estimatedWeightLbs: pricingMetaRef.current.estimatedWeightLbs,
        longDistanceDistanceKm: pricingMetaRef.current.longDistanceDistanceKm,
        longDistanceTruckCost: pricingMetaRef.current.longDistanceTruckCost,
        longDistanceGasCost: pricingMetaRef.current.longDistanceGasCost,
        longDistanceInsuranceCost: pricingMetaRef.current.longDistanceInsuranceCost,
        longDistanceMiscCost: pricingMetaRef.current.longDistanceMiscCost,
        longDistanceMarkupRate: pricingMetaRef.current.longDistanceMarkupRate,
        moveDescription: nextMoveDescription || undefined,
        internalNotes: nextInternalNotes || undefined,
      })
      setQuote(result.quote)
      if (result.lead) setLead(result.lead)
      setQuoteLineItems(result.quote.lineItems || [])
      setQuoteDiscountAmount(Number(result.quote.discountAmount || 0))
      setQuoteDiscountLabel(result.quote.discountLabel || '')
      setQuoteMoveDescription(result.quote.moveDescription || '')
      setQuoteInternalNotes(result.quote.internalNotes || '')
      setQuoteModalDirty(false)
      // Persist inventory + job factors to lead alongside the quote save
      // This ensures Include Back / Exclude toggles survive page reloads
      if (lead) {
        void updateSalesLead(lead.id, {
          inventory: inventoryMetrics.inventory,
          totalItems: inventoryMetrics.totalItems,
          totalCubicFeet: inventoryMetrics.totalCubicFeet,
          totalWeightLbs: inventoryMetrics.totalWeightLbs,
          roomBreakdown: buildRoomBreakdown(inventoryMetrics.inventory),
          ...(Object.keys(jobFactors).length > 0 ? { jobFactors } : {}),
        }).catch(() => {})
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setQuoteModalBusy(false)
    }
  }

  async function saveAndPreviewQuote(options?: {
    provisional?: boolean
    missingItems?: string[]
    moveDescription?: string
    internalNotes?: string
  }) {
    if (!quote) return
    if (!ensureLeadEditable()) return
    await saveQuoteDraft({
      moveDescription: options?.moveDescription,
      internalNotes: options?.internalNotes,
    })
    if (options?.provisional && lead) {
      const followUpDate = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
      const missingSummary = (options.missingItems || []).filter(Boolean).join(' · ') || 'Missing quote details still need confirmation.'
      const followUpText = `Provisional quote sent. Collect before final confirmation: ${missingSummary}`
      try {
        const followUpResult = await saveSalesFollowUp({
          leadId: lead.id,
          quoteId: quote.id,
          type: 'note',
          notes: followUpText,
          followUpDate,
        })
        mergeFollowUpLog(followUpResult.log)
        const refreshedLead = await updateSalesLead(lead.id, {
          followUpDate,
          followUpNote: followUpText,
        })
        setLead(refreshedLead)
      } catch (err) {
        setError((err as Error).message)
        return
      }
    }
    router.push(`/sales/quotes/${quote.id}?send=1${options?.provisional ? '&provisional=1' : ''}`)
  }

  async function sendDepositLink() {
    if (!quote || !lead) return
    if (!ensureLeadEditable()) return
    try {
      setDepositLinkBusy(true)
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || window.location.origin
      const acceptUrl = `${appUrl}/quote-accept?id=${encodeURIComponent(quote.id)}&token=${encodeURIComponent(quote.acceptToken || '')}`
      const r = await fetch('/api/sales/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ quoteId: quote.id }),
      })
      const payload = await r.json() as { url?: string; error?: string }
      if (!r.ok || !payload.url) throw new Error(payload.error || 'Could not create payment link')
      // Open payment link — rep copies it or forwards to customer
      window.open(payload.url, '_blank')
      // Also send via SMS if phone available
      if (lead.phone) {
        const smsBody = encodeURIComponent(
          `Hi ${lead.name?.split(' ')[0] || 'there'}, please complete your Saturn Star deposit here to lock in your move date: ${payload.url}`
        )
        window.open(`sms:${lead.phone}?body=${smsBody}`)
      }
      void acceptUrl // used above
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setDepositLinkBusy(false)
    }
  }

  async function logManualDeposit() {
    if (!lead || !quote) return
    if (!ensureLeadEditable()) return
    try {
      setLogDepositBusy(true)
      const methodLabels = { cash: 'Cash', etransfer: 'Interac E-Transfer', cheque: 'Cheque' }
      const methodLabel = methodLabels[logDepositMethod]

      // Update CRM lead
      const updatedLead = await updateSalesLead(lead.id, {
        paymentStatus: 'deposit_received',
        depositAmount: quote.deposit,
        depositMethod: methodLabel,
        depositDate: new Date().toISOString().slice(0, 10),
      })
      setLead(updatedLead)
      setLogDepositOpen(false)
      setLogDepositNote('')

      // Record in Stripe as out-of-band invoice (fire & forget — don't block UI)
      void fetch('/api/sales/stripe/record-cash', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          leadId: lead.id,
          leadName: lead.name,
          leadEmail: lead.email,
          leadPhone: lead.phone,
          quoteNumber: quote.number,
          amount: quote.deposit,
          method: logDepositMethod,
          description: `Deposit – ${quote.number} – ${lead.name} – ${methodLabel}`,
        }),
      }).catch(() => null)

      // Send receipt email if we have an email address
      if (lead.email) {
        void fetch('/api/sales/deposit-receipt', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            toEmail: lead.email,
            toName: lead.name,
            quoteNumber: quote.number,
            moveDate: quote.moveDate,
            originCity: quote.originCity,
            destCity: quote.destCity,
            depositAmount: quote.deposit,
            balanceAmount: quote.balance,
            totalAmount: quote.total,
            paymentMethod: methodLabel,
          }),
        }).catch(() => null)
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLogDepositBusy(false)
    }
  }

  async function clearManualDepositMark() {
    if (!lead) return
    if (!ensureLeadEditable()) return
    if (!window.confirm('Clear the recorded deposit status for this lead? Use this only when a deposit was marked by mistake.')) return
    try {
      setLogDepositBusy(true)
      const updatedLead = await updateSalesLead(lead.id, {
        paymentStatus: 'pending',
        depositAmount: undefined,
        depositMethod: undefined,
        depositDate: undefined,
      })
      setLead(updatedLead)
      setError(null)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLogDepositBusy(false)
    }
  }

  async function chargeBalance() {
    if (!lead || !quote) return
    if (!ensureLeadEditable()) return
    if (!window.confirm(`Charge the remaining balance of ${formatMoney(quote.balance)} to the card on file?`)) return
    try {
      setChargeBalanceBusy(true)
      const r = await fetch('/api/sales/stripe/charge-balance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ leadId: lead.id, quoteId: quote.id }),
      })
      const payload = await r.json() as { ok?: boolean; error?: string; balance?: number; amount?: number }
      if (!r.ok || !payload.ok) throw new Error(payload.error || 'Charge failed')
      const updatedLead = await updateSalesLead(lead.id, { paymentStatus: 'paid_in_full' })
      setLead(updatedLead)
      setQuote(current => current ? {
        ...current,
        balance: Number(payload.balance || 0),
        balancePaidAt: new Date().toISOString(),
        balancePaidAmount: Number((current.balancePaidAmount || 0) + Number(payload.amount || 0)),
        balancePaidMethod: 'stripe',
      } : current)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setChargeBalanceBusy(false)
    }
  }

  async function sendBalanceInvoice() {
    if (!lead || !quote) return
    if (!ensureLeadEditable()) return
    const defaultAmount = Number(quote.balance || 0).toFixed(2)
    const amountInput = window.prompt('Invoice amount to send', defaultAmount)
    if (amountInput === null) return
    const amount = Math.round(Number(amountInput) * 100) / 100
    if (!Number.isFinite(amount) || amount <= 0) {
      setError('Invoice amount must be greater than zero.')
      return
    }
    const defaultDescription = `Remaining balance - ${quote.number} - ${lead.name}`
    const description = window.prompt('Invoice note', defaultDescription)
    if (description === null) return

    try {
      setSendInvoiceBusy(true)
      const response = await fetch('/api/sales/stripe/send-invoice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          leadId: lead.id,
          quoteId: quote.id,
          amountOverride: amount,
          description,
        }),
      })
      const payload = await response.json() as {
        ok?: boolean
        error?: string
        hostedInvoiceUrl?: string
        quote?: CRMQuote
      }
      if (!response.ok || !payload.ok) throw new Error(payload.error || 'Failed to send invoice')
      if (payload.quote) setQuote(payload.quote)
      if (payload.hostedInvoiceUrl) window.open(payload.hostedInvoiceUrl, '_blank')
      setError(null)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSendInvoiceBusy(false)
    }
  }

  async function saveOutcome() {
    if (!lead) return
    if (!ensureLeadEditable()) return
    setOutcomeBusy(true)
    try {
      const response = await fetch(`/api/sales/leads/${lead.id}/outcome`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          actual_hours: outcomeActualHours ? Number(outcomeActualHours) : undefined,
          actual_crew: outcomeActualCrew ? Number(outcomeActualCrew) : undefined,
          damage_flag: outcomeDamage,
          customer_rating: outcomeRating || undefined,
          review_left: outcomeReview,
          referral_generated: outcomeReferral,
          notes: outcomeNotes.trim() || undefined,
        }),
      })
      const payload = await response.json() as { error?: string; lead?: CRMLead; quote?: CRMQuote | null }
      if (!response.ok) throw new Error(payload.error || 'Failed to save outcome')
      if (payload.lead) setLead(payload.lead)
      if (payload.quote !== undefined) setQuote(payload.quote)
      setOutcomeSaved(true)
      setOutcomeOpen(false)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setOutcomeBusy(false)
    }
  }

  async function sendReviewRequest() {
    if (!lead) return
    if (!ensureLeadEditable()) return
    setReviewSentBusy(true)
    try {
      const response = await fetch('/api/sales/review-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          leadId: lead.id,
          leadName: lead.name,
          leadEmail: lead.email,
          leadPhone: lead.phone,
          quoteNumber: quote?.number,
          channel: 'both',
        }),
      })
      const payload = await response.json() as { ok?: boolean; error?: string; lead?: CRMLead | null }
      if (!response.ok || payload.error) throw new Error(payload.error || 'Failed to send review request')
      if (payload.lead) setLead(payload.lead)
      setReviewSent(true)
      setError(null)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setReviewSentBusy(false)
    }
  }

  async function closeQuoteModal() {
    if (quoteModalDirty) {
      await saveQuoteDraft()
    }
    setQuoteModalOpen(false)
  }

  async function lookupListingForLead() {
    if (!lead || !originAddress.trim()) {
      setError('Add an origin address first so the CRM can match the listing.')
      return
    }
    if (!ensureLeadEditable()) return

    try {
      setListingLookupBusy(true)
      // Step 1: match the listing
      const result = await enrichSalesAddress(originAddress.trim(), false)
      if (!result.listing) {
        throw new Error('No listing match found for this address yet.')
      }

      const updates: Partial<CRMLead> = {
        originAddress: originAddress.trim(),
        originCity: originCity || result.listing.city || undefined,
        supabaseListing: result.listing,
      }
      const saved = await updateSalesLead(lead.id, updates)
      setLead(saved)
      if (saved.originCity) setOriginCity(saved.originCity)
      setError(null)

      // Step 2: immediately kick off streaming photo scan
      void streamScanForLead(lead.id)
    } catch (err) {
      setError((err as Error).message)
      setListingLookupBusy(false)
    }
  }

  async function streamScanForLead(leadId: string) {
    if (!ensureLeadEditable()) return
    try {
      setListingLookupBusy(true)
      setInventory([])
      setScanProgress({ batch: 0, totalBatches: 0, status: 'Starting photo scan…' })

      const response = await fetch(`/api/sales/leads/${leadId}/scan-stream`, {
        method: 'POST',
        credentials: 'include',
      })

      if (!response.ok) {
        throw new Error(await response.text())
      }

      const reader = response.body!.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let allItems: InventoryItem[] = []

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const event = JSON.parse(line.slice(6)) as {
              type: string
              batch?: number
              totalBatches?: number
              totalPhotos?: number
              status?: string
              items?: InventoryItem[]
              runningCount?: number
              allItems?: InventoryItem[]
              error?: string
              truckRecommendation?: { count: number; size: string; label: string; bufferedCubicFeet: number }
              validationFlags?: string[]
            }

            if (event.type === 'start') {
              if ((event.totalBatches ?? 0) > 0) {
                setScanProgress({ batch: 0, totalBatches: event.totalBatches ?? 0, status: `Scanning ${event.totalPhotos ?? 0} photos…` })
              }
            } else if (event.type === 'progress') {
              setScanProgress({ batch: event.batch ?? 0, totalBatches: event.totalBatches ?? 0, status: event.status ?? '' })
            } else if (event.type === 'batch') {
              allItems = [...allItems, ...(event.items ?? [])]
              setInventory([...allItems])
              setScanProgress({
                batch: event.batch ?? 0,
                totalBatches: event.totalBatches ?? 0,
                status: `Room ${event.batch}/${event.totalBatches} done — ${allItems.length} items found…`,
              })
            } else if (event.type === 'done') {
              const metrics = deriveInventoryMetrics(allItems)
              const finalSaved = await updateSalesLead(leadId, {
                inventory: metrics.inventory,
                totalItems: metrics.totalItems,
                totalCubicFeet: metrics.totalCubicFeet,
                totalWeightLbs: metrics.totalWeightLbs,
                roomBreakdown: buildRoomBreakdown(metrics.inventory),
              })
              setLead(finalSaved)
              setScanProgress(null)
              if (event.truckRecommendation) {
                setScanResult({
                  totalItems: metrics.totalItems,
                  truckLabel: event.truckRecommendation.label,
                  cubicFeet: event.truckRecommendation.bufferedCubicFeet,
                  flags: event.validationFlags ?? [],
                })
                setTimeout(() => setScanResult(null), 12000)
              }
            } else if (event.type === 'error' || event.type === 'batch_error') {
              setError(event.error ?? 'Scan error')
            }
          } catch {
            // malformed SSE line — skip
          }
        }
      }
    } catch (err) {
      setError((err as Error).message)
      setScanProgress(null)
    } finally {
      setListingLookupBusy(false)
      setScanProgress(null)
    }
  }

  function openDialer() {
    if (!lead?.phone || typeof window === 'undefined') return
    window.dispatchEvent(new CustomEvent('crm:open-dialer', { detail: { phone: lead.phone, leadId: lead.id, name: lead.name } }))
  }

  async function fetchLeadEmails(leadId: string) {
    try {
      setEmailsLoading(true)
      const res = await fetch(`/api/sales/emails?leadId=${leadId}`)
      if (res.ok) {
        const data = await res.json() as typeof emailMessages
        setEmailMessages(data)
      }
    } catch { /* non-fatal */ } finally {
      setEmailsLoading(false)
    }
  }

  const fetchLeadSms = useCallback(async (phone: string, showSpinner = false) => {
    try {
      if (showSpinner) setSmsLoading(true)
      const res = await fetch(`/api/sales/sms-threads?phone=${encodeURIComponent(phone)}`)
      if (res.ok) {
        const data = await res.json() as typeof smsMessages
        setSmsMessages(data)
        setTimeout(() => {
          if (smsAreaRef.current) smsAreaRef.current.scrollTop = smsAreaRef.current.scrollHeight
        }, 40)
      }
    } catch { /* non-fatal */ } finally {
      if (showSpinner) setSmsLoading(false)
    }
  }, [])

  // Poll SMS every 15 s while SMS tab is active
  useEffect(() => {
    if (activeTab !== 'sms' || !lead?.phone) return
    void fetchLeadSms(lead.phone, true)
    const interval = window.setInterval(() => void fetchLeadSms(lead!.phone!), 15_000)
    return () => clearInterval(interval)
  }, [activeTab, lead?.phone, fetchLeadSms])

  const leadPreferredBranchNumber = useMemo(() => {
    for (let index = smsMessages.length - 1; index >= 0; index -= 1) {
      const branchNumber = getSaturnBusinessNumberFromSmsMessage(smsMessages[index])
      if (branchNumber) return branchNumber
    }

    const recentCallBranch = (lead?.callLogs || [])
      .slice()
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .map(item => item.branchNumber)
      .find(Boolean)

    return pickSaturnBranchPhoneNumber(recentCallBranch, getDefaultSaturnBranchNumber())
  }, [lead?.callLogs, smsMessages])

  const leadPreferredBranchLabel = useMemo(
    () => getSaturnBranchLabel(leadPreferredBranchNumber),
    [leadPreferredBranchNumber]
  )

  function getLeadFirstName(currentLead: CRMLead) {
    const rawName =
      currentLead.primaryContactRole === 'customer'
        ? currentLead.name
        : currentLead.realtorName || currentLead.name
    if (!rawName || /^realtor lead\b/i.test(rawName)) return 'there'
    return rawName.split(' ')[0]
  }

  function getDestinationOpportunityStatusLabel(currentLead: CRMLead) {
    if (currentLead.destinationOpportunityStatus === 'generated') return 'Lead generated'
    if (currentLead.destinationOpportunityStatus === 'linked_existing') return 'Existing lead linked'
    if (currentLead.destinationOpportunityStatus === 'outside_area') return 'Outside local branch area'
    if (currentLead.destinationOpportunityStatus === 'no_match') return 'No MLS match found'
    return 'Not checked'
  }

  function getRealtorLookupStatusLabel(currentLead: CRMLead) {
    if (currentLead.realtorLookupStatus === 'matched') return 'Realtor contact matched'
    if (currentLead.realtorLookupStatus === 'partial') return 'Brokerage matched, contact still needed'
    if (currentLead.realtorLookupStatus === 'missing') return 'Realtor contact still missing'
    return 'Lookup not started'
  }

  function openRealtorPitchSms() {
    if (!lead) return
    if (!ensureLeadCommunicationAccess()) return
    const firstName = (lead.realtorName || lead.name || 'there').split(' ')[0]
    const address = lead.opportunityAddress || lead.destAddress || lead.originAddress || 'the property'
    const moveMonth = (() => {
      const d = lead.sourceLeadMoveDate || lead.moveDate
      if (!d) return 'the coming weeks'
      return new Date(d + 'T12:00:00').toLocaleDateString('en-CA', { month: 'long' })
    })()
    composerUserEdited.current = true  // lock template — skip AI override
    setComposerChannel('sms')
    setComposerSubject('')
    setComposerBody(
      `Hi ${firstName}, John here from Saturn Star Moving.\n\nQuick one — we're already coordinating a move at ${address} in ${moveMonth}.\n\nFor your clients: if they book through you, they get 20% off (our standard referral is 10%, but we double it for realtor partners). No paperwork on your end — just pass our number or send me theirs and I'll reach out directly.\n\nYour client saves more, you look great.\n\n— John | Saturn Star Moving | 226-773-2993`
    )
    setComposerOpen(true)
  }

  function openComposer(channel: 'sms' | 'email') {
    if (!lead) return
    if (!ensureLeadCommunicationAccess()) return
    const firstName = getLeadFirstName(lead)
    const opportunityAddress = lead.opportunityAddress || lead.originAddress || 'the property'
    composerUserEdited.current = false   // reset — AI may write the first draft
    setComposerChannel(channel)
    setComposerSubject(
      channel === 'email'
        ? lead.leadKind === 'realtor_opportunity' && lead.primaryContactRole === 'realtor'
          ? `Move opportunity at ${opportunityAddress} — Saturn Star Moving`
          : 'Following up — Saturn Star Moving'
        : ''
    )
    // Set a brief placeholder while AI drafts — user can start typing immediately
    setComposerBody(
      lead.leadKind === 'realtor_opportunity' && lead.primaryContactRole === 'realtor'
        ? (
            channel === 'sms'
              ? `Hi ${firstName}, this is Saturn Star Moving. We're already coordinating a move into ${opportunityAddress} and wanted to see if your client there needs a quote as well. We may be able to offer a discounted rate since our trucks are already heading that way.`
              : `Hi ${firstName},\n\nThis is Saturn Star Moving. We are already coordinating a move into ${opportunityAddress} and wanted to see if the current occupant also needs a moving quote.\n\nBecause our trucks are already scheduled for that address, we may be able to offer a discounted rate and move quickly. If helpful, we can also review the move remotely and keep the process simple for your client.\n\nLet me know if you would like us to reach out directly or send over details.\n\nSaturn Star Moving`
          )
        : (
            channel === 'sms'
              ? `Hi ${firstName}, this is Saturn Star Moving — just following up on your move. What date are you working with?`
              : `Hi ${firstName},\n\nJust following up on your move with Saturn Star Moving. Let me know if you have any questions or want to lock in a date.\n\nJohn\nSaturn Star Moving`
          )
    )
    setComposerOpen(true)
    // Immediately kick off AI — it will replace the placeholder only if user hasn't edited yet
    void runSmartCompose(channel, lead)
  }

  async function sendComposerMessage() {
    if (!lead) return
    if (!ensureLeadCommunicationAccess()) return
    const to = composerChannel === 'sms' ? lead.phone : lead.email
    if (!to || !composerBody.trim()) return

    try {
      setComposerBusy(true)
      const result = await sendSalesMessage({
        channel: composerChannel,
        to,
        subject: composerChannel === 'email' ? composerSubject.trim() || 'Following up — Saturn Star Moving' : undefined,
        body: composerBody.trim(),
        leadId: lead.id,
        quoteId: quote?.id,
        fromNumber: composerChannel === 'sms' ? leadPreferredBranchNumber : undefined,
        notes: `${composerChannel.toUpperCase()} sent from lead detail`,
      })
      setComposerOpen(false)
      mergeFollowUpLog(result.log)
      setError(null)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setComposerBusy(false)
    }
  }

  async function handleClientHandoff() {
    if (!lead) return
    if (!ensureLeadEditable()) return

    try {
      setHandoffBusy(true)
      const result = await handoffRealtorOpportunityLead(lead.id, {
        name: handoffName.trim(),
        phone: handoffPhone.trim() || undefined,
        email: handoffEmail.trim() || undefined,
      })
      applyLeadSnapshot(result.lead, { hydrateForm: true })
      mergeFollowUpLog(result.log)
      setOpportunityNotice('Lead switched from realtor contact to client contact.')
      setError(null)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setHandoffBusy(false)
    }
  }

  async function runSmartCompose(channel: 'sms' | 'email', currentLead: typeof lead) {
    if (!currentLead) return
    try {
      setScBusy(true)
      const smsHistory = followUps.filter(f => f.type === 'sms').map(f => ({ direction: 'outbound', body: f.notes || '', created_at: f.date }))
      const emailHistory = followUps.filter(f => f.type === 'email').map(f => ({ direction: 'outbound', subject: f.notes || '', body: '', created_at: f.date }))
      const res = await fetch('https://saturn-lead-intake.johnowolabi80.workers.dev/smart-compose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lead: currentLead, smsHistory, emailHistory, channel }),
      })
      const data = await res.json() as { ok: boolean; draft?: string; subject?: string; error?: string }
      if (data.ok && data.draft && !composerUserEdited.current) {
        setComposerBody(data.draft)
        if (channel === 'email' && data.subject) setComposerSubject(data.subject)
      }
    } catch {
      // AI failed silently — user still has the default template in the box
    } finally {
      setScBusy(false)
    }
  }

  function updateInventoryItem(index: number, field: keyof InventoryItem, value: string) {
    setInventory(current =>
      current.map((item, itemIndex) =>
        itemIndex === index
          ? {
              ...item,
              [field]: field === 'qty' || field === 'cubicFeet' || field === 'weightLbs' ? Number(value || 0) : value,
            }
          : item
      )
    )
  }

  function toggleInventoryItem(index: number) {
    setInventory(current => {
      const next = current.map((item, itemIndex) => {
        if (itemIndex !== index) return item
        const nowIncluded = item.included === false
        return {
          ...item,
          included: nowIncluded,
          exclusionReason: nowIncluded ? '' : item.exclusionReason || 'Excluded from move scope',
          policyOverride: nowIncluded && (item.policyCategory === 'default_exclude' || getMovePolicyFinding(item)?.category === 'default_exclude') ? 'include' as const : undefined,
        }
      })
      // Immediately persist inventory to server so Include Back survives page reloads
      if (lead?.id) {
        const metrics = deriveInventoryMetrics(next)
        void updateSalesLead(lead.id, {
          inventory: metrics.inventory,
          totalItems: metrics.totalItems,
          totalCubicFeet: metrics.totalCubicFeet,
          totalWeightLbs: metrics.totalWeightLbs,
          roomBreakdown: buildRoomBreakdown(metrics.inventory),
        }).catch(() => {})
      }
      return next
    })
  }

  function removeInventoryItem(index: number) {
    setInventory(current => current.filter((_, i) => i !== index))
  }

  function addPresetItem(presetId: string) {
    const preset = INVENTORY_PRESETS.find(item => item.id === presetId)
    if (!preset) return
    setInventory(current => [...current, createInventoryItemFromPreset(preset)])
    setPresetSearch('')
  }

  async function logActivity() {
    if (!lead || !activityNotes.trim()) return
    if (!ensureLeadCommunicationAccess()) return
    try {
      setLoggingActivity(true)
      const result = await saveSalesFollowUp({
        leadId: lead.id,
        quoteId: quote?.id,
        type: activityType,
        notes: activityNotes.trim(),
        followUpDate: followUpDate || undefined,
      })
      setActivityNotes('')
      mergeFollowUpLog(result.log)
      if (result.lead) {
        applyLeadSnapshot(result.lead)
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoggingActivity(false)
    }
  }

  async function logIncident() {
    if (!lead || !incidentDesc.trim()) return
    if (!ensureLeadEditable()) return
    setIncidentBusy(true)
    try {
      const r = await fetch('/api/sales/leads/note', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          leadId: lead.id,
          text: `[INCIDENT — ${incidentType.replace('_', ' ').toUpperCase()}] ${incidentDesc.trim()}`,
          type: 'incident',
        }),
      })
      const result = await r.json() as { log?: FollowUpLog }
      if (result.log) mergeFollowUpLog(result.log)
      setIncidentOpen(false)
      setIncidentDesc('')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setIncidentBusy(false)
    }
  }

  async function startConsultation() {
    if (!ensureLeadCommunicationAccess()) return
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const recorder = new MediaRecorder(stream)
      consultationChunksRef.current = []
      recorder.ondataavailable = event => {
        if (event.data.size > 0) {
          consultationChunksRef.current.push(event.data)
        }
      }
      recorder.start()
      consultationRecorderRef.current = recorder
      consultationStreamRef.current = stream
      setConsultationSeconds(0)
      setConsultationActive(true)
      setError(null)
    } catch (err) {
      setError((err as Error).message || 'Unable to access microphone for consultation recording.')
    }
  }

  async function stopConsultation() {
    if (!lead) return
    if (!ensureLeadCommunicationAccess()) return

    try {
      setConsultationSaving(true)
      const recorder = consultationRecorderRef.current
      const stream = consultationStreamRef.current
      let recordingUrl: string | undefined

      if (recorder && recorder.state !== 'inactive') {
        const audioBlob = await new Promise<Blob>(resolve => {
          recorder.onstop = () => {
            // Strip codec params (e.g. "audio/webm;codecs=opus" → "audio/webm") so data URL parses cleanly
            const mimeBase = (recorder.mimeType || 'audio/webm').split(';')[0]
            resolve(new Blob(consultationChunksRef.current, { type: mimeBase }))
          }
          recorder.stop()
        })
        if (stream) {
          stream.getTracks().forEach(track => track.stop())
        }
        if (audioBlob.size > 0) {
          recordingUrl = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader()
            reader.onloadend = () => resolve(typeof reader.result === 'string' ? reader.result : '')
            reader.onerror = () => reject(new Error('Failed to encode consultation recording.'))
            reader.readAsDataURL(audioBlob)
          })
        }
      }

      const saved = await saveLeadConsultation(lead.id, {
        notes: consultationNotes.trim() || undefined,
        summary: consultationSummary.trim() || undefined,
        recordingUrl,
        durationSeconds: consultationSeconds,
      })

      applyLeadSnapshot(saved, { hydrateForm: true })
      setConsultationNotes('')
      setConsultationSummary('')
      setConsultationSeconds(0)
      setConsultationActive(false)
      consultationRecorderRef.current = null
      consultationStreamRef.current = null
      consultationChunksRef.current = []
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setConsultationSaving(false)
    }
  }

  async function removeLead() {
    if (!lead) return
    if (!canDeleteCurrentLead) {
      setError('Only a manager or the owner can delete a lead.')
      return
    }
    if (!window.confirm(`Delete ${lead.name || 'this lead'} from the active queue? You can restore it later from the Deleted leads view.`)) {
      return
    }

    try {
      setDeleteBusy(true)
      await deleteSalesLead(lead.id)
      router.push('/sales/leads')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setDeleteBusy(false)
    }
  }

  function formatSeconds(seconds: number) {
    const minutes = Math.floor(seconds / 60)
    const remainder = String(seconds % 60).padStart(2, '0')
    return `${minutes}:${remainder}`
  }

  function kindLabel(kind: string) {
    if (kind === 'sms') return 'SMS'
    if (kind === 'email') return 'Email'
    if (kind === 'view') return 'Quote Viewed'
    if (kind === 'accept') return 'Quote Accepted'
    if (kind === 'decline') return 'Quote Declined'
    if (kind === 'consultation') return 'Consultation'
    return kind.replace(/_/g, ' ')
  }

  async function generateInventoryFromPhotos(forceAnalyze = false) {
    if (!lead?.supabaseListing?.address) return
    if (!ensureLeadEditable()) return
    try {
      setAnalysisBusy(true)
      const result = await enrichSalesAddress(lead.supabaseListing.address, true, forceAnalyze)
      if (!result.scan) {
        throw new Error('No inventory draft was returned from MLS photo analysis.')
      }

      const nextInventory = result.scan.inventory || []
      const nextMetrics = deriveInventoryMetrics(nextInventory)
      setInventory(nextInventory)

      const saved = await updateSalesLead(lead.id, {
        inventory: nextMetrics.inventory,
        totalItems: nextMetrics.totalItems,
        totalCubicFeet: nextMetrics.totalCubicFeet,
        totalWeightLbs: nextMetrics.totalWeightLbs,
        roomBreakdown: buildRoomBreakdown(nextMetrics.inventory),
      })

      setLead(saved)
      setError(null)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setAnalysisBusy(false)
    }
  }

  if (!params?.id) {
    return <div className="crm-shell"><div className="crm-panel p-16 text-center text-sm text-stone-500">Loading lead...</div></div>
  }

  if (!lead) {
    return <div className="crm-shell"><div className="crm-panel p-16 text-center text-sm text-stone-500">{error || 'Lead not found'}</div></div>
  }

  return (
    <div className="crm-shell space-y-6">
      {error && <div className="rounded-[8px] border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-700">{error}</div>}
      {scanProgress && (
        <div className="rounded-[8px] border border-emerald-200 bg-emerald-50 px-5 py-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-medium text-emerald-800">📷 Scanning photos…</span>
            <span className="text-xs text-emerald-700">
              {scanProgress.totalBatches > 0 ? `Room ${scanProgress.batch} of ${scanProgress.totalBatches}` : 'Starting…'}
            </span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-emerald-200">
            <div
              className="h-full rounded-full bg-emerald-500 transition-all duration-500"
              style={{ width: scanProgress.totalBatches > 0 ? `${Math.round((scanProgress.batch / scanProgress.totalBatches) * 100)}%` : '5%' }}
            />
          </div>
          <div className="mt-1.5 text-xs text-emerald-700">{scanProgress.status}</div>
        </div>
      )}
      {scanResult && !scanProgress && (
        <div className="rounded-[8px] border border-emerald-200 bg-emerald-50 px-5 py-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-emerald-800">✅ Scan complete — {scanResult.totalItems} items</span>
            <span className="text-xs font-semibold text-emerald-700">🚛 {scanResult.truckLabel} ({scanResult.cubicFeet} cu ft +10% buffer)</span>
          </div>
          {scanResult.flags.length > 0 && (
            <div className="mt-2 space-y-0.5">
              {scanResult.flags.map((f, i) => <div key={i} className="text-xs text-amber-700">{f}</div>)}
            </div>
          )}
        </div>
      )}
      {opportunityNotice ? (
        <div className="rounded-[8px] border border-sky-200 bg-sky-50 px-5 py-4 text-sm text-sky-800">
          {opportunityNotice}
        </div>
      ) : null}
      {leadReadOnlyReason ? (
        <div className="rounded-[8px] border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-800">
          {leadReadOnlyReason}
        </div>
      ) : null}

      {leadGuidance ? (
        <section className={`sticky top-[92px] z-30 rounded-[12px] border border-[var(--app-line)] bg-white transition-all ${leadCommandBarCompact ? 'shadow-md' : 'shadow-sm'}`}>
          <div className={`${guidancePanelCollapsed ? '' : 'border-b border-[var(--app-line)]'} ${guidancePanelCollapsed ? 'px-4 py-2.5' : leadCommandBarCompact ? 'px-4 py-3' : 'px-5 py-4'}`}>
            {guidancePanelCollapsed ? (
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-[var(--app-ink)] truncate">
                  <span className="truncate">{lead.name}</span>
                  <span className="rounded-full bg-[var(--app-bg)] px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] text-[var(--app-muted)] shrink-0">{leadGuidance.stageLabel}</span>
                  <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold shrink-0 ${leadGuidance.heat.tone === 'risk' ? 'border-rose-200 bg-rose-50 text-rose-700' : leadGuidance.heat.tone === 'hot' ? 'border-orange-200 bg-orange-50 text-orange-700' : 'border-slate-200 bg-slate-50 text-slate-600'}`}>{leadGuidance.heat.label} · {leadGuidance.heat.score}</span>
                </div>
                <button onClick={toggleGuidancePanel} className="shrink-0 rounded-[6px] border border-[var(--app-line)] bg-[var(--app-bg)] px-2.5 py-1 text-xs font-medium text-[var(--app-muted)] hover:border-[var(--app-ink)] hover:text-[var(--app-ink)]">▼ Expand</button>
              </div>
            ) : (
            <div className={`flex flex-col ${leadCommandBarCompact ? 'gap-2 xl:flex-row xl:items-center xl:justify-between' : 'gap-3 xl:flex-row xl:items-start xl:justify-between'}`}>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-[var(--app-ink)]">
                  <span className={`truncate ${leadCommandBarCompact ? 'text-sm' : 'text-base'}`}>{lead.name}</span>
                  <span className="rounded-full bg-[var(--app-bg)] px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] text-[var(--app-muted)]">{leadGuidance.stageLabel}</span>
                  <span className="rounded-full bg-[var(--app-bg)] px-2 py-0.5 text-[10px] font-medium text-[var(--app-muted)]">{leadGuidance.branchLabel}</span>
                  <span className="rounded-full bg-[var(--app-bg)] px-2 py-0.5 text-[10px] font-medium text-[var(--app-muted)]">Owner: {leadGuidance.ownerLabel}</span>
                  <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                    leadGuidance.heat.tone === 'risk' ? 'border-rose-200 bg-rose-50 text-rose-700' :
                    leadGuidance.heat.tone === 'hot' ? 'border-orange-200 bg-orange-50 text-orange-700' :
                    leadGuidance.heat.tone === 'warm' ? 'border-amber-200 bg-amber-50 text-amber-700' :
                    leadGuidance.heat.tone === 'dormant' ? 'border-fuchsia-200 bg-fuchsia-50 text-fuchsia-700' :
                    'border-slate-200 bg-slate-50 text-slate-600'
                  }`}>
                    {leadGuidance.heat.label} · {leadGuidance.heat.score}
                  </span>
                  {leadGuidance.action.goldenMoment ? (
                    <span className="rounded-full border border-orange-200 bg-orange-100 px-2 py-0.5 text-[10px] font-semibold text-orange-800">QUOTE VIEWED NOW</span>
                  ) : null}
                  {leadCommandBarCompact && leadGuidance.ownerLabel === 'Unassigned' ? (
                    <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-800">No owner</span>
                  ) : null}
                </div>

                <div className={`flex flex-wrap gap-2 text-[var(--app-muted)] ${leadCommandBarCompact ? 'mt-1 text-xs' : 'mt-2 text-sm'}`}>
                  <span>{leadGuidance.quoteStatusLine}</span>
                  {lead.moveDate ? <span>Move date {formatDate(lead.moveDate)}</span> : null}
                  <span>Last activity {leadGuidance.latestActivity.at ? formatRelativeTime(leadGuidance.latestActivity.at) : '—'}</span>
                  {leadCommandBarCompact && leadGuidance.missingInfo.length > 0 ? (
                    <span className="text-amber-700">Missing: {leadGuidance.missingInfo.slice(0, 2).join(', ')}</span>
                  ) : null}
                </div>

                {!leadCommandBarCompact && leadGuidance.personaBadges.length > 0 ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {leadGuidance.personaBadges.map(badge => (
                      <span key={badge.label} className="rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-[11px] font-medium text-sky-800">
                        {badge.label} · {badge.confidence}%
                      </span>
                    ))}
                  </div>
                ) : null}

                {!leadCommandBarCompact && leadGuidance.missingInfo.length > 0 ? (
                  <div className="mt-3 text-sm text-amber-700">
                    Missing: {leadGuidance.missingInfo.join(', ')}
                  </div>
                ) : null}

                <div className={`rounded-[10px] bg-[#1a2744]/5 ${leadCommandBarCompact ? 'mt-2 px-3 py-2' : 'mt-3 px-4 py-3'}`}>
                  <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#1a2744]/60">Next Action</div>
                  <div className={`mt-1 font-semibold text-[#1a2744] ${leadCommandBarCompact ? 'text-xs' : 'text-sm'}`}>{leadGuidance.action.nextAction}</div>
                  {!leadCommandBarCompact ? (
                    <div className="mt-1 text-sm text-[#1a2744]/70">{leadGuidance.salesLanguage}</div>
                  ) : null}
                </div>

                {!leadCommandBarCompact && leadGuidance.ownerLabel === 'Unassigned' ? (
                  <div className="mt-3 rounded-[8px] border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                    No owner assigned. This lead may be missed.
                  </div>
                ) : null}
              </div>

              <div className={`flex shrink-0 flex-wrap gap-2 xl:justify-end ${leadCommandBarCompact ? 'xl:max-w-[460px]' : 'xl:max-w-[360px]'}`}>
                <button
                  onClick={toggleGuidancePanel}
                  title={guidancePanelCollapsed ? 'Expand guidance panel' : 'Collapse guidance panel'}
                  className={`rounded-[8px] border border-[var(--app-line)] bg-[var(--app-bg)] font-medium text-[var(--app-muted)] hover:border-[var(--app-ink)] hover:text-[var(--app-ink)] ${leadCommandBarCompact ? 'px-2 py-1.5 text-xs' : 'px-3 py-2 text-sm'}`}
                >
                  {guidancePanelCollapsed ? '▼ Expand' : '▲ Collapse'}
                </button>
                <button
                  onClick={() => void handleLeadCommandAction(leadGuidance.action.primaryCta.key)}
                  className={`rounded-[8px] bg-[var(--app-ink)] font-semibold text-white hover:bg-[#0f1b2d] ${leadCommandBarCompact ? 'px-3 py-1.5 text-xs' : 'px-4 py-2 text-sm'}`}
                >
                  {leadGuidance.action.primaryCta.label}
                </button>
                {leadGuidance.action.secondaryCtas.slice(0, leadCommandBarCompact ? 2 : 3).map(cta => (
                  <button
                    key={cta.key}
                    onClick={() => void handleLeadCommandAction(cta.key)}
                    className={`rounded-[8px] border border-[var(--app-line)] bg-white font-semibold text-[var(--app-ink)] hover:border-[var(--app-ink)] ${leadCommandBarCompact ? 'px-3 py-1.5 text-xs' : 'px-4 py-2 text-sm'}`}
                  >
                    {cta.label}
                  </button>
                ))}
                {leadGuidance.ownerLabel === 'Unassigned' ? (
                  <button
                    onClick={() => void handleLeadCommandAction('assign_to_me')}
                    className={`rounded-[8px] border border-amber-300 bg-amber-50 font-semibold text-amber-800 hover:bg-amber-100 ${leadCommandBarCompact ? 'px-3 py-1.5 text-xs' : 'px-4 py-2 text-sm'}`}
                  >
                    Assign to me
                  </button>
                ) : null}
                <button
                  onClick={() => void handleLeadCommandAction('mark_lost')}
                  className={`rounded-[8px] border border-rose-200 bg-rose-50 font-semibold text-rose-700 hover:bg-rose-100 ${leadCommandBarCompact ? 'px-3 py-1.5 text-xs' : 'px-4 py-2 text-sm'}`}
                >
                  Mark Lost
                </button>
                {canDeleteCurrentLead ? (
                  <button
                    onClick={() => void removeLead()}
                    disabled={deleteBusy}
                    className={`rounded-[8px] border border-rose-200 bg-white font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-60 ${leadCommandBarCompact ? 'px-3 py-1.5 text-xs' : 'px-4 py-2 text-sm'}`}
                  >
                    {deleteBusy ? 'Deleting...' : 'Delete Lead'}
                  </button>
                ) : null}
              </div>
            </div>
            )}
          </div>
        </section>
      ) : null}

      <div className="overflow-hidden rounded-[8px] border border-[var(--app-line)] bg-[var(--app-panel)]">
        {/* Lead header bar */}
        <div className="flex flex-wrap items-center gap-3 border-b border-[var(--app-line)] bg-white px-5 py-3">
          <button
            type="button"
            onClick={handleBackNavigation}
            className="inline-flex items-center gap-1 rounded-[8px] border border-[var(--app-line)] bg-[var(--app-bg)] px-3 py-1.5 text-xs font-semibold text-[var(--app-ink)] transition hover:border-[var(--app-ink)]"
          >
            ← Back
          </button>
          <h1 className="font-display text-base font-semibold text-[var(--app-ink)]">{lead.name}</h1>
          <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em] ${
            lead.stage === 'customer_success' ? 'bg-sky-100 text-sky-700' :
            lead.stage === 'completed' ? 'bg-indigo-100 text-indigo-700' :
            lead.stage === 'booked' ? 'bg-emerald-100 text-emerald-700' :
            lead.stage === 'lost' ? 'bg-rose-100 text-rose-600' :
            lead.stage === 'tentative' ? 'bg-orange-100 text-orange-700' :
            lead.stage === 'quoted' || lead.stage === 'pricing' ? 'bg-amber-100 text-amber-700' :
            lead.stage === 'estimate_scheduled' || lead.stage === 'estimate_completed' ? 'bg-violet-100 text-violet-700' :
            'bg-stone-100 text-stone-600'
          }`}>
            {SALES_LEAD_STAGES.find(s => s.id === lead.stage)?.label || lead.stage}
          </span>
          {lead.contextFlag ? (
            <span className="rounded-full border border-sky-200 bg-sky-50 px-2.5 py-0.5 text-[10px] font-semibold text-sky-700">
              {LEAD_CONTEXT_FLAGS.find(f => f.id === lead.contextFlag)?.label || lead.contextFlag}
            </span>
          ) : null}
          {lead.leadKind === 'realtor_opportunity' ? (
            <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-[10px] font-semibold text-amber-700">
              Realtor Opportunity
            </span>
          ) : null}
          {lead.branch ? (
            <span className="rounded-full border border-stone-200 bg-stone-50 px-2.5 py-0.5 text-[10px] font-semibold text-stone-700">
              {getSalesBranchLabel(lead.branch)}
            </span>
          ) : null}
          {lead.leadKind === 'realtor_opportunity' ? (
            <span className="rounded-full border border-[var(--app-line)] bg-[var(--app-bg)] px-2.5 py-0.5 text-[10px] font-semibold text-[var(--app-ink)]">
              Active contact: {lead.primaryContactRole === 'customer' ? 'Client' : 'Realtor'}
            </span>
          ) : null}
          <span className="ml-auto text-xs text-[var(--app-muted)]">
            Owner: {leadOwnerName}
          </span>
          {!canEditCurrentLead ? (
            <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-[10px] font-semibold text-amber-700">
              View only
            </span>
          ) : null}
          {lead.stage === 'estimate_scheduled' && lead.estimateDate ? (
            <span className="rounded-full bg-violet-50 px-2.5 py-0.5 text-[10px] font-semibold text-violet-700">
              {lead.consultationTriggerReason ? '🏠 Consultation' : 'Estimate'}: {formatDate(lead.estimateDate)}{lead.estimateTime ? ` @ ${lead.estimateTime}` : ''}
              {lead.consultationAssignedManagerName ? ` — ${lead.consultationAssignedManagerName}` : ''}
            </span>
          ) : null}
        </div>

        {/* Pre-visit brief — shows when consultation is booked */}
        {lead.consultationPreVisitBrief && lead.stage === 'estimate_scheduled' && (
          <div className="mx-3 mb-3 rounded-[12px] border border-violet-200 bg-violet-50 md:mx-8">
            <div className="flex items-center justify-between px-4 py-3 border-b border-violet-200">
              <div>
                <div className="text-xs font-bold uppercase tracking-wider text-violet-700">🏠 In-Home Move Consultation</div>
                <div className="mt-0.5 text-xs text-violet-600">
                  {lead.estimateDate ? formatDate(lead.estimateDate) : 'Date TBD'}
                  {lead.estimateTime ? ` at ${lead.estimateTime}` : ''}
                  {lead.consultationAssignedManagerName ? ` · ${lead.consultationAssignedManagerName}` : ''}
                </div>
              </div>
              <button
                onClick={async () => {
                  if (!lead?.id) return
                  const msg = `🏠 LIVE ESTIMATE REQUEST\n${lead.name} | ${lead.phone || 'no phone'}\n${lead.consultationAssignedManagerName || 'Manager'} is onsite and ready for live quote handoff. Open CRM: ${window.location.href}`
                  await sendSalesMessage({ leadId: lead.id, channel: 'sms', body: msg, to: '+12267241730' }).catch(() => {})
                  alert('Alert sent to office ✅')
                }}
                className="rounded-[8px] bg-[#f5a623] px-3 py-1.5 text-xs font-bold text-[#1a2744] hover:bg-[#e09420] transition-colors"
                title="Alert central sales — manager is onsite and ready for live handoff"
              >
                📞 Request Live Estimate
              </button>
            </div>
            <div className="px-4 py-3">
              {lead.consultationTriggerReason && (
                <div className="mb-2 text-xs text-violet-700"><strong>Visit reason:</strong> {lead.consultationTriggerReason}</div>
              )}
              {lead.consultationCustomerConcern && (
                <div className="mb-2 text-xs text-violet-700"><strong>Customer concern:</strong> {lead.consultationCustomerConcern}</div>
              )}
              <details>
                <summary className="cursor-pointer text-xs font-semibold text-violet-700 hover:text-violet-900">View Pre-Visit Brief ▾</summary>
                <pre className="mt-2 whitespace-pre-wrap rounded-[8px] bg-white border border-violet-200 px-3 py-2 text-[11px] text-slate-700 font-mono">{lead.consultationPreVisitBrief}</pre>
              </details>
            </div>
          </div>
        )}

        <div className="grid min-h-[760px] lg:grid-cols-[minmax(0,1fr)_300px] xl:grid-cols-[250px_minmax(0,1fr)_280px]">
          <LeadBasicsPanel
            lead={lead}
            leadName={leadName}
            leadPhone={leadPhone}
            leadEmail={leadEmail}
            leadSource={leadSource}
            moveDate={moveDate}
            branch={branch}
            moveDateFlexible={moveDateFlexible}
            moveDateFlexibleReason={moveDateFlexibleReason}
            moveType={moveType}
            originAddress={originAddress}
            originCity={originCity}
            originAccess={originAccess}
            destAddress={destAddress}
            destCity={destCity}
            destAccess={destAccess}
            parkingNotes={parkingNotes}
            moveReason={moveReason}
            totalCubicFeet={inventoryMetrics.totalCubicFeet}
            disabled={!canEditCurrentLead}
            onLeadNameChange={setLeadName}
            onLeadPhoneChange={setLeadPhone}
            onLeadEmailChange={setLeadEmail}
            onLeadSourceChange={setLeadSource}
            onMoveDateChange={setMoveDate}
            onMoveDateFlexibleChange={v => {
              setMoveDateFlexible(v)
              // Auto-set 3-day follow-up when Date TBD is toggled on
              if (v && !followUpDate) {
                const d = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000)
                setFollowUpDate(d.toISOString().slice(0, 10))
              }
            }}
            onMoveDateFlexibleReasonChange={setMoveDateFlexibleReason}
            onMoveTypeChange={setMoveType}
            onBranchChange={setBranch}
            onOriginAddressChange={setOriginAddress}
            onOriginCityChange={setOriginCity}
            onOriginAccessChange={setOriginAccess}
            onDestAddressChange={setDestAddress}
            onDestCityChange={setDestCity}
            onDestAccessChange={setDestAccess}
            onParkingNotesChange={setParkingNotes}
            onApartmentDetected={(field, info) => {
              setJobFactors(prev => ({
                ...prev,
                ...(field === 'origin'
                  ? { originFloors: info.floor, originHasElevator: info.hasElevator }
                  : { destFloors: info.floor, destHasElevator: info.hasElevator }),
              }))
            }}
            listingLookupBusy={listingLookupBusy}
            hasListing={!!lead.supabaseListing}
            onScanListing={() => {
              // Always re-fetch listing so supabaseListing.carouselphotos is fresh,
              // then stream the photo scan. Needed because stored carouselphotos may be stale.
              void lookupListingForLead()
            }}
          />

          <aside className="order-2 border-t border-[var(--app-line)] bg-[var(--app-panel)] lg:order-3 lg:border-l lg:border-t-0 xl:order-3">
            <LeadIntelligencePanel
              lead={lead}
              onLeadUpdate={setLead}
              onApplyFollowUp={(date, note) => {
                setFollowUpDate(date)
              }}
              onApplyStage={(s) => {
                setStage(s)
              }}
            />
            {lead.leadKind === 'realtor_opportunity' ? (
              <div className="border-b border-[var(--app-line)] p-5">
                <div className="crm-label">Realtor Opportunity</div>
                <div className="mt-3 rounded-[10px] border border-amber-200 bg-amber-50/70 p-4">
                  <div className="text-sm font-semibold text-amber-900">
                    {lead.opportunityAddress || lead.originAddress || 'Address pending'}
                  </div>
                  <div className="mt-1 text-xs leading-5 text-amber-800">
                    {lead.sourceLeadName ? `Generated from ${lead.sourceLeadName}.` : 'Auto-generated from another move.'}
                    {lead.sourceLeadMoveDate ? ` Source move date: ${formatDate(lead.sourceLeadMoveDate)}.` : ''}
                  </div>
                  {lead.sourceLeadId ? (
                    <Link
                      href={`/sales/leads/${lead.sourceLeadId}`}
                      className="mt-3 inline-flex text-xs font-semibold text-amber-900 underline decoration-amber-300 underline-offset-4"
                    >
                      Open source lead
                    </Link>
                  ) : null}
                  <div className="mt-3 space-y-2 text-xs text-amber-900">
                    <div>Branch: {lead.branch ? getSalesBranchLabel(lead.branch) : 'Auto-detect pending'}</div>
                    <div>Lookup: {getRealtorLookupStatusLabel(lead)}</div>
                    <div>Brokerage: {lead.realtorBrokerage || lead.supabaseListing?.brokername || 'Not captured yet'}</div>
                    <div>Realtor name: {lead.realtorName || (lead.primaryContactRole === 'realtor' ? lead.name : 'Not captured yet')}</div>
                    <div>Realtor email: {lead.realtorEmail || (lead.primaryContactRole === 'realtor' ? lead.email || 'Not captured yet' : 'Not captured yet')}</div>
                    <div>Realtor phone: {lead.realtorPhone || (lead.primaryContactRole === 'realtor' ? lead.phone || 'Not captured yet' : 'Not captured yet')}</div>
                  </div>
                  {/* Auto-find realtor info */}
                  {canEditCurrentLead && !(lead.realtorName && lead.realtorPhone) && (
                    <button
                      onClick={() => void (async () => {
                        setSaving(true)
                        try {
                          const res = await fetch(`/api/sales/leads/${lead.id}/realtor-lookup`, { method: 'POST', credentials: 'include' })
                          const data = await res.json() as {
                            realtorName?: string | null
                            realtorPhone?: string | null
                            realtorEmail?: string | null
                            realtorBrokerage?: string | null
                            confidence?: string
                            source?: string
                            error?: string
                          }
                          if (!res.ok || data.error) throw new Error(data.error)
                          const updates: Record<string, string> = {}
                          if (data.realtorName && !lead.realtorName) updates.realtorName = data.realtorName
                          if (data.realtorPhone && !lead.realtorPhone) updates.realtorPhone = data.realtorPhone
                          if (data.realtorEmail && !lead.realtorEmail) updates.realtorEmail = data.realtorEmail
                          if (data.realtorBrokerage && !lead.realtorBrokerage) updates.realtorBrokerage = data.realtorBrokerage
                          if (Object.keys(updates).length > 0) {
                            const saved = await updateSalesLead(lead.id, updates as Parameters<typeof updateSalesLead>[1])
                            applyLeadSnapshot(saved, { hydrateForm: true })
                          }
                          setError(null)
                        } catch (err) { setError((err as Error).message) }
                        finally { setSaving(false) }
                      })()}
                      disabled={saving}
                      className="mt-3 w-full rounded-[6px] border border-amber-300 bg-amber-100 px-3 py-1.5 text-[10px] font-semibold text-amber-800 hover:bg-amber-200 disabled:opacity-60"
                    >
                      {saving ? '🔍 Searching…' : '🔍 Auto-find Realtor Info'}
                    </button>
                  )}
                  {canHandleCurrentLeadCommunication && lead.primaryContactRole === 'realtor' && lead.phone && (
                    <button
                      onClick={() => openRealtorPitchSms()}
                      className="mt-2 w-full rounded-[6px] border border-amber-400 bg-amber-200 px-3 py-1.5 text-[10px] font-semibold text-amber-900 hover:bg-amber-300 transition-colors"
                    >
                      📱 Pitch Realtor — Send SMS
                    </button>
                  )}
                </div>

                {lead.primaryContactRole === 'realtor' ? (
                  <div className="mt-4 space-y-3 rounded-[10px] border border-[var(--app-line)] bg-white p-4">
                    <div>
                      <div className="text-sm font-semibold text-[var(--app-ink)]">Client Handoff</div>
                      <div className="mt-1 text-xs leading-5 text-[var(--app-muted)]">
                        When the realtor gives you the actual client, switch this lead to the client contact so quote, booking, receipt, and reminder messages go to the right person.
                      </div>
                    </div>
                    <input
                      value={handoffName}
                      onChange={event => setHandoffName(event.target.value)}
                      className="crm-input"
                      placeholder="Client name"
                    />
                    <input
                      value={handoffPhone}
                      onChange={event => setHandoffPhone(event.target.value)}
                      className="crm-input"
                      placeholder="Client phone"
                    />
                    <input
                      value={handoffEmail}
                      onChange={event => setHandoffEmail(event.target.value)}
                      className="crm-input"
                      placeholder="Client email"
                    />
                    <button
                      onClick={() => void handleClientHandoff()}
                      disabled={!canEditCurrentLead || handoffBusy || !handoffName.trim() || (!handoffPhone.trim() && !handoffEmail.trim())}
                      className="crm-button w-full justify-center disabled:opacity-60"
                    >
                      {handoffBusy ? 'Switching Contact...' : 'Switch Active Contact To Client'}
                    </button>
                  </div>
                ) : (
                  <div className="mt-4 rounded-[10px] border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs leading-5 text-emerald-800">
                    Client contact is now active on this lead. Realtor details stay here for reference and follow-up.
                  </div>
                )}
              </div>
            ) : (
              (lead.destinationOpportunityStatus || lead.destinationOpportunityLeadId) ? (
                <div className="border-b border-[var(--app-line)] p-5">
                  <div className="crm-label">Destination Opportunity</div>
                  <div className="mt-3 rounded-[10px] border border-sky-200 bg-sky-50/70 p-4">
                    <div className="text-sm font-semibold text-sky-900">
                      {getDestinationOpportunityStatusLabel(lead)}
                    </div>
                    <div className="mt-1 text-xs leading-5 text-sky-800">
                      Destination saved as {lead.destAddress || lead.destCity || 'pending destination'}.
                      {lead.destinationOpportunityLastCheckedAt ? ` Last checked ${formatDateTime(lead.destinationOpportunityLastCheckedAt)}.` : ''}
                    </div>
                    {lead.destinationOpportunityLeadId ? (
                      <Link
                        href={`/sales/leads/${lead.destinationOpportunityLeadId}`}
                        className="mt-3 inline-flex text-xs font-semibold text-sky-900 underline decoration-sky-300 underline-offset-4"
                      >
                        Open generated realtor lead
                      </Link>
                    ) : null}
                  </div>
                </div>
              ) : null
            )}

            {/* Confirm Job CTA — prominent when lead has a quote and isn't booked yet */}
            {quote && !isClosedLeadStage(lead.stage) && !(lead.leadKind === 'realtor_opportunity' && lead.primaryContactRole === 'realtor') ? (
              <div className="border-b border-[var(--app-line)] bg-[#f0faf5] p-5">
                <div className="crm-label text-[var(--app-accent)]">Ready to close?</div>
                <button
                  onClick={() => openConfirmJobModal()}
                  disabled={!canEditCurrentLead}
                  className="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-[10px] bg-[var(--app-accent)] text-sm font-semibold text-white transition hover:bg-[#0a5b47]"
                >
                  Confirm Job + Send Booking
                </button>
              </div>
            ) : quote && lead.leadKind === 'realtor_opportunity' && lead.primaryContactRole === 'realtor' ? (
              <div className="border-b border-[var(--app-line)] bg-amber-50 p-5">
                <div className="crm-label text-amber-700">Waiting on client handoff</div>
                <div className="mt-2 text-sm leading-6 text-amber-900">
                  Quote work can continue, but booking stays locked until the realtor hands over the actual client contact.
                </div>
              </div>
            ) : isBookedLikeStage(lead.stage) ? (
              <div className="border-b border-[var(--app-line)] bg-[#f0faf5] p-5 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${
                    lead.stage === 'customer_success'
                      ? 'bg-sky-100 text-sky-700'
                      : lead.stage === 'completed'
                        ? 'bg-indigo-100 text-indigo-700'
                        : 'bg-emerald-100 text-emerald-700'
                  }`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${
                      lead.stage === 'customer_success'
                        ? 'bg-sky-500'
                        : lead.stage === 'completed'
                          ? 'bg-indigo-500'
                          : 'bg-emerald-500'
                    }`} />
                    {lead.stage === 'customer_success' ? 'Customer Success' : lead.stage === 'completed' ? 'Move Completed' : 'Job Confirmed'}
                  </span>
                </div>
                {/* Crew Dispatch Brief */}
                <button
                  onClick={() => void generateDispatchBrief()}
                  disabled={dispatchBriefBusy}
                  className="w-full rounded-[8px] bg-[#1a2744] px-3 py-2 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-60"
                >
                  {dispatchBriefBusy ? '⏳ Generating…' : '📋 Generate Crew Briefing'}
                </button>
                {/* Post-job review request */}
                {(lead.email || lead.phone) && (
                  <button
                    onClick={() => void sendReviewRequest()}
                    disabled={!canEditCurrentLead || reviewSentBusy || reviewSent}
                    className="w-full rounded-[8px] bg-[#f5a623] px-3 py-2 text-xs font-semibold text-[#1a2744] hover:opacity-90 disabled:opacity-60"
                  >
                    {reviewSent ? '⭐ Review Request Sent!' : reviewSentBusy ? 'Sending...' : '⭐ Send Review Request'}
                  </button>
                )}
                <button
                  onClick={() => setOutcomeOpen(o => !o)}
                  disabled={!canEditCurrentLead}
                  className="w-full rounded-[8px] border border-[var(--app-line)] bg-white px-3 py-2 text-xs font-medium text-[var(--app-ink)] hover:border-[var(--app-ink)]"
                >
                  {outcomeSaved ? '✓ Outcome Logged' : '📋 Log Job Outcome'}
                </button>
                {outcomeOpen && (
                  <div className="space-y-3 rounded-[10px] border border-[var(--app-line)] bg-[var(--app-bg)] p-4">
                    <div className="crm-label">Post-Job Outcome</div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-[var(--app-muted)]">Actual Hours</label>
                        <input type="number" min="0" step="0.5" value={outcomeActualHours} onChange={e => setOutcomeActualHours(e.target.value)} className="crm-input w-full text-xs" placeholder="e.g. 4.5" />
                      </div>
                      <div>
                        <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-[var(--app-muted)]">Actual Crew</label>
                        <input type="number" min="1" max="10" value={outcomeActualCrew} onChange={e => setOutcomeActualCrew(e.target.value)} className="crm-input w-full text-xs" placeholder="e.g. 3" />
                      </div>
                    </div>
                    <div>
                      <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-[var(--app-muted)]">Customer Rating</label>
                      <div className="flex gap-1">
                        {[1, 2, 3, 4, 5].map(star => (
                          <button key={star} type="button" disabled={!canEditCurrentLead} onClick={() => setOutcomeRating(star)} className={`text-xl transition ${outcomeRating >= star ? 'text-amber-400' : 'text-stone-300'}`}>★</button>
                        ))}
                      </div>
                    </div>
                    <div className="space-y-2">
                      <label className="flex items-center gap-2 text-xs text-[var(--app-ink)]">
                        <input type="checkbox" checked={outcomeDamage} onChange={e => setOutcomeDamage(e.target.checked)} className="rounded" />
                        Damage / Incident reported
                      </label>
                      <label className="flex items-center gap-2 text-xs text-[var(--app-ink)]">
                        <input type="checkbox" checked={outcomeReview} onChange={e => setOutcomeReview(e.target.checked)} className="rounded" />
                        Google/Yelp review left
                      </label>
                      <label className="flex items-center gap-2 text-xs text-[var(--app-ink)]">
                        <input type="checkbox" checked={outcomeReferral} onChange={e => setOutcomeReferral(e.target.checked)} className="rounded" />
                        Referral generated
                      </label>
                    </div>
                    <textarea value={outcomeNotes} onChange={e => setOutcomeNotes(e.target.value)} disabled={!canEditCurrentLead} className="crm-input w-full resize-none text-xs" rows={2} placeholder="Any notes about the job..." />
                    <button onClick={() => void saveOutcome()} disabled={!canEditCurrentLead || outcomeBusy} className="w-full rounded-[8px] bg-[#1a2744] px-3 py-2 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-60">
                      {outcomeBusy ? 'Saving...' : 'Save Outcome'}
                    </button>
                  </div>
                )}

                {/* DEPOSIT STATUS */}
                {lead.paymentStatus === 'paid_in_full' ? (
                  <div className="rounded-[8px] bg-emerald-600 px-3 py-2.5 text-center text-xs font-bold text-white">
                    ✓ Paid in Full
                  </div>
                ) : lead.paymentStatus === 'deposit_received' ? (
                  <div className="space-y-2">
                    <div className="rounded-[8px] border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700">
                      ✓ Deposit Received — {lead.depositMethod || 'On file'}
                    </div>
                    {quote && (
                      <div className="space-y-2">
                        <button
                          onClick={() => void chargeBalance()}
                          disabled={!canEditCurrentLead || chargeBalanceBusy}
                          className="w-full rounded-[8px] bg-[var(--app-accent)] px-3 py-2 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-60"
                        >
                          {chargeBalanceBusy ? 'Charging...' : `Charge Balance — ${formatMoney(quote.balance)}`}
                        </button>
                        <button
                          onClick={() => void sendBalanceInvoice()}
                          disabled={!canEditCurrentLead || sendInvoiceBusy || !lead.email}
                          className="w-full rounded-[8px] border border-[var(--app-line)] bg-white px-3 py-2 text-xs font-semibold text-[var(--app-ink)] hover:border-[var(--app-ink)] disabled:opacity-60"
                        >
                          {sendInvoiceBusy ? 'Sending invoice...' : lead.email ? 'Send Balance Invoice' : 'Need customer email to invoice'}
                        </button>
                        {!quote.depositPaidAt && !quote.depositPaidAmount && !quote.depositStripePaymentIntentId && !quote.depositStripeSessionId ? (
                          <button
                            onClick={() => void clearManualDepositMark()}
                            disabled={!canEditCurrentLead || logDepositBusy}
                            className="w-full rounded-[8px] border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-100 disabled:opacity-60"
                          >
                            {logDepositBusy ? 'Clearing...' : 'Clear Deposit Mark'}
                          </button>
                        ) : null}
                      </div>
                    )}
                  </div>
                ) : (
                  /* No deposit yet — collection required */
                  <div className="rounded-[8px] border border-[#1a2744]/20 bg-[#1a2744]/5 p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold uppercase tracking-widest text-[#1a2744]">Deposit Required</span>
                      {quote && <span className="text-xs font-semibold text-[#1a2744]">{formatMoney(quote.deposit)}</span>}
                    </div>
                    <p className="text-[11px] text-[var(--app-muted)]">{quote ? 'Needed to confirm this job.' : 'Required before this job moves to operations.'}</p>
                    {quote && (
                      <>
                        <button
                          onClick={() => setCollectCardOpen(true)}
                          disabled={!canEditCurrentLead}
                          className="w-full rounded-[8px] bg-[#f5a623] px-3 py-2 text-xs font-bold text-[#1a2744] hover:opacity-90"
                        >
                          💳 Collect Card &amp; Charge Now
                        </button>
                        <button
                          onClick={() => void sendDepositLink()}
                          disabled={!canEditCurrentLead || depositLinkBusy}
                          className="w-full rounded-[8px] bg-[#1a2744] px-3 py-2 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-60"
                        >
                          {depositLinkBusy ? 'Sending...' : '🔗 Send Self-Pay Link (SMS)'}
                        </button>
                      </>
                    )}
                    <button
                      onClick={() => setLogDepositOpen(open => !open)}
                      disabled={!canEditCurrentLead}
                      className="w-full rounded-[8px] border border-[#1a2744]/20 bg-white px-3 py-2 text-xs font-medium text-[#1a2744] hover:bg-[#1a2744]/5"
                    >
                      Log Cash / E-Transfer / Cheque
                    </button>
                    {logDepositOpen && (
                      <div className="space-y-2 pt-1">
                        <select
                          value={logDepositMethod}
                          onChange={e => setLogDepositMethod(e.target.value as 'cash' | 'etransfer' | 'cheque')}
                          className="crm-input w-full text-xs"
                        >
                          <option value="cash">Cash</option>
                          <option value="etransfer">Interac E-Transfer</option>
                          <option value="cheque">Cheque</option>
                        </select>
                        <input
                          className="crm-input w-full text-xs"
                          placeholder="Note (optional — ref number, who collected...)"
                          value={logDepositNote}
                          onChange={e => setLogDepositNote(e.target.value)}
                        />
                        <button
                          onClick={() => void logManualDeposit()}
                          disabled={!canEditCurrentLead || logDepositBusy}
                          className="w-full rounded-[8px] bg-[#1a2744] px-3 py-2 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-60"
                        >
                          {logDepositBusy ? 'Saving...' : '✓ Mark Deposit Received'}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : null}

            <div className="space-y-3 border-b border-[var(--app-line)] p-5">
              {lead.phone ? <button onClick={openDialer} disabled={!canHandleCurrentLeadCommunication} className="crm-button-dark w-full justify-center disabled:opacity-60">Call Lead</button> : null}
              <div className="grid grid-cols-2 gap-3">
                {lead.phone ? <button onClick={() => openComposer('sms')} disabled={!canHandleCurrentLeadCommunication} className="crm-button justify-center disabled:opacity-60">Send SMS</button> : <div />}
                {lead.email ? <button onClick={() => openComposer('email')} disabled={!canHandleCurrentLeadCommunication} className="crm-button justify-center disabled:opacity-60">Email</button> : <div />}
              </div>
              <button
                onClick={() => void startConsultation()}
                disabled={!canHandleCurrentLeadCommunication || consultationActive || consultationSaving}
                className="crm-button w-full justify-center"
              >
                {consultationActive ? `Recording Consultation • ${formatSeconds(consultationSeconds)}` : consultationSaving ? 'Saving Consultation...' : 'Record Consultation'}
              </button>
              <button
                onClick={() => setFastLaneOpen(true)}
                disabled={!canEditCurrentLead || !lead.phone}
                className="crm-button w-full justify-center border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100 disabled:opacity-60"
                title="Send a quick SMS quote — no inventory scan needed"
              >
                ⚡ Fast Lane Quote
              </button>

              {/* In-Home Move Consultation */}
              {!isClosedLeadStage(lead.stage) && canEditCurrentLead && (
                <button
                  onClick={() => setShowConsultationModal(true)}
                  className="crm-button w-full justify-center border-violet-200 bg-violet-50 text-violet-700 hover:border-violet-400 disabled:opacity-60"
                >
                  🏠 Book In-Home Consultation
                </button>
              )}

              {quote ? (
                <button onClick={() => void openQuoteBuilder()} disabled={!canEditCurrentLead} className="crm-button w-full justify-center border-[rgba(34,72,56,0.2)] bg-[rgba(34,72,56,0.08)] text-[var(--app-accent)] disabled:opacity-60">
                  Build Estimate
                </button>
              ) : (
                <button onClick={() => void openQuoteBuilder()} disabled={!canEditCurrentLead || creatingQuote} className="crm-button w-full justify-center border-[rgba(34,72,56,0.2)] bg-[rgba(34,72,56,0.08)] text-[var(--app-accent)] disabled:opacity-60">
                  {creatingQuote ? 'Building...' : 'Build Estimate'}
                </button>
              )}
              {/* Add a second job for the same contact (e.g. residential + commercial) */}
              {quote && (
                <button
                  onClick={() => void createQuote(true)}
                  disabled={!canEditCurrentLead || creatingQuote}
                  className="crm-button w-full justify-center disabled:opacity-60"
                  title="Create a separate quote for a different job (e.g. commercial, second move)"
                >
                  {creatingQuote ? 'Building...' : '+ Add Another Job'}
                </button>
              )}
              {/* Linked jobs panel */}
              {additionalQuotes.length > 0 && (
                <div className="rounded-[8px] border border-[var(--app-line)] bg-[var(--app-bg)] p-3 space-y-1.5">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--app-muted)]">All Linked Jobs</div>
                  {quote && (
                    <Link href={`/sales/quotes/${quote.id}`} className="flex items-center justify-between rounded-[6px] bg-white px-3 py-2 text-xs hover:bg-[var(--app-panel)]">
                      <span className="font-medium text-[var(--app-ink)]">{quote.number}</span>
                      <span className="text-[var(--app-muted)] capitalize">{quote.moveType || 'residential'} · {quote.status}</span>
                    </Link>
                  )}
                  {additionalQuotes.map(aq => (
                    <Link key={aq.id} href={`/sales/quotes/${aq.id}`} className="flex items-center justify-between rounded-[6px] bg-white px-3 py-2 text-xs hover:bg-[var(--app-panel)]">
                      <span className="font-medium text-[var(--app-ink)]">{aq.number}</span>
                      <span className="text-[var(--app-muted)] capitalize">{aq.moveType || 'residential'} · {aq.status}</span>
                    </Link>
                  ))}
                </div>
              )}
              {/* Photo survey request */}
              <button
                onClick={() => void requestPhotoSurvey()}
                disabled={!canEditCurrentLead || surveyBusy}
                className="crm-button w-full justify-center disabled:opacity-60"
                title="Customer just takes photos — AI scanning happens on our side"
              >
                {surveyBusy ? '⏳ Generating link…'
                  : (lead as unknown as Record<string,unknown>)?.surveyCompletedAt ? '📷 Resend Photo Request'
                  : (lead as unknown as Record<string,unknown>)?.surveyRequestedAt ? '📷 Resend Photo Request'
                  : '📷 Request Photos'}
              </button>

              {/* Survey photos received — scan button */}
              {(() => {
                const surveyPhotos = (lead.mediaAssets || []).filter((a: import('@/lib/types').LeadMediaAsset) => a.source === 'survey' && a.kind === 'image')
                const surveyCompleted = !!(lead as unknown as Record<string,unknown>)?.surveyCompletedAt
                const surveyScanned = !!(lead as unknown as Record<string,unknown>)?.surveyScannedAt
                if (surveyPhotos.length === 0) return null
                return (
                  <div className={`rounded-[8px] border px-3 py-3 ${surveyCompleted && !surveyScanned ? 'border-emerald-300 bg-emerald-50' : 'border-[var(--app-line)] bg-[var(--app-bg)]'}`}>
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <div className="text-xs font-semibold text-[var(--app-ink)]">
                        📷 {surveyPhotos.length} customer photo{surveyPhotos.length !== 1 ? 's' : ''} received
                        {surveyCompleted && <span className="ml-1 text-emerald-600">· Survey complete</span>}
                      </div>
                    </div>
                    <button
                      onClick={() => void (async () => {
                        setSurveyBusy(true)
                        try {
                          const res = await fetch(`/api/sales/leads/${lead.id}/scan-survey`, { method: 'POST', credentials: 'include' })
                          const data = await res.json() as { ok?: boolean; detectedItems?: number; scannedRooms?: string[]; error?: string }
                          if (!res.ok || data.error) throw new Error(data.error)
                          await refresh(lead.id)
                        } catch (err) { setError((err as Error).message) }
                        finally { setSurveyBusy(false) }
                      })()}
                      disabled={surveyBusy}
                      className={`w-full rounded-[6px] py-2 text-xs font-semibold transition ${surveyScanned ? 'bg-[var(--app-bg)] text-[var(--app-muted)] border border-[var(--app-line)]' : 'bg-emerald-600 text-white hover:bg-emerald-700'} disabled:opacity-60`}
                    >
                      {surveyBusy ? '⏳ Scanning…' : surveyScanned ? '✓ Re-scan customer photos' : '🔍 Scan customer photos into inventory'}
                    </button>
                    {surveyScanned && <div className="mt-1.5 text-[10px] text-[var(--app-muted)]">Last scanned {new Date((lead as unknown as Record<string,unknown>).surveyScannedAt as string).toLocaleString('en-CA', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</div>}
                  </div>
                )
              })()}

              {surveyUrl && (
                <div className="rounded-[8px] border border-[var(--app-line)] bg-[var(--app-bg)] p-2.5 text-[10px] text-[var(--app-muted)] break-all">
                  {surveyUrl}
                  <button
                    type="button"
                    onClick={() => { void navigator.clipboard.writeText(surveyUrl) }}
                    className="ml-1.5 text-[var(--app-accent)] font-semibold"
                  >Copy</button>
                </div>
              )}
              <div className="rounded-[8px] border border-[var(--app-line)] bg-[var(--app-bg)] p-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--app-muted)]">Rep Media Upload</div>
                    <div className="mt-1 text-xs text-[var(--app-muted)]">
                      Upload customer photos or videos directly into this lead when MLS photos are missing or the move is custom.
                    </div>
                  </div>
                  <div className="rounded-full bg-white px-2.5 py-1 text-[10px] font-semibold text-[var(--app-muted)]">
                    {(lead.mediaAssets || []).length} file{(lead.mediaAssets || []).length === 1 ? '' : 's'}
                  </div>
                </div>
                <div className="mt-3 grid gap-2">
                  <select
                    value={mediaUploadRoom}
                    onChange={event => setMediaUploadRoom(event.target.value)}
                    disabled={!canEditCurrentLead}
                    className="crm-input"
                  >
                    {DEFAULT_ROOM_OPTIONS.map(option => (
                      <option key={option} value={option}>{option}</option>
                    ))}
                  </select>
                  <input
                    ref={mediaUploadInputRef}
                    type="file"
                    accept="image/*,video/*"
                    multiple
                    className="hidden"
                    onChange={event => setMediaUploadFiles(Array.from(event.target.files || []))}
                  />
                  <button
                    type="button"
                    disabled={!canEditCurrentLead}
                    onClick={() => mediaUploadInputRef.current?.click()}
                    className="crm-button justify-center disabled:opacity-60"
                  >
                    {mediaUploadFiles.length > 0 ? `Selected ${mediaUploadFiles.length} file${mediaUploadFiles.length === 1 ? '' : 's'}` : 'Choose Photos Or Videos'}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleRepMediaUpload()}
                    disabled={!canEditCurrentLead || mediaUploadBusy || mediaUploadFiles.length === 0}
                    className="crm-button w-full justify-center disabled:opacity-60"
                  >
                    {mediaUploadBusy ? 'Scanning upload…' : 'Upload And Scan Inventory'}
                  </button>
                  {mediaUploadNotice ? (
                    <div className="rounded-[6px] border border-[var(--app-line)] bg-white px-3 py-2 text-[11px] text-[var(--app-muted)]">
                      {mediaUploadNotice}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="border-b border-[var(--app-line)] p-5">
              <div className="flex items-center justify-between">
                <div className="crm-label">Tasks</div>
                <span className="text-xs text-[var(--app-muted)]">AI + follow-up</span>
              </div>
              <div className="mt-4 space-y-3 text-sm">
                {aiNudge ? (
                  <div className={`rounded-[8px] border px-3 py-3 ${aiNudge.urgency === 'high' ? 'border-amber-200 bg-amber-50' : aiNudge.urgency === 'medium' ? 'border-sky-200 bg-sky-50' : 'border-[var(--app-line)] bg-[var(--app-bg)]'}`}>
                    <div className={`flex items-start gap-2 text-sm font-medium ${aiNudge.urgency === 'high' ? 'text-amber-800' : aiNudge.urgency === 'medium' ? 'text-sky-800' : 'text-[var(--app-ink)]'}`}>
                      <span>{aiNudge.icon}</span>
                      <span>{aiNudge.text}</span>
                    </div>
                    <div className={`mt-1.5 text-xs ${aiNudge.urgency === 'high' ? 'text-amber-700' : aiNudge.urgency === 'medium' ? 'text-sky-700' : 'text-[var(--app-muted)]'}`}>
                      {aiNudge.action}
                    </div>
                    {(aiNudge.urgency === 'high' || aiNudge.urgency === 'medium') && (lead.phone || lead.email) ? (
                      <div className="mt-3 flex gap-2">
                        {lead.phone ? <button onClick={() => openComposer('sms')} disabled={!canHandleCurrentLeadCommunication} className="rounded-[6px] bg-white px-3 py-1.5 text-xs font-medium text-[var(--app-ink)] shadow-sm ring-1 ring-inset ring-[var(--app-line)] hover:bg-[var(--app-bg)] disabled:opacity-60">Send SMS</button> : null}
                        {lead.email ? <button onClick={() => { setActiveTab('emails'); setComposerChannel('email') }} disabled={!canHandleCurrentLeadCommunication} className="rounded-[6px] bg-white px-3 py-1.5 text-xs font-medium text-[var(--app-ink)] shadow-sm ring-1 ring-inset ring-[var(--app-line)] hover:bg-[var(--app-bg)] disabled:opacity-60">Email</button> : null}
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <div className="rounded-[8px] border border-[var(--app-line)] bg-[var(--app-bg)] px-3 py-3">
                    <div className="text-sm font-medium text-[var(--app-ink)]">
                      {lead.followUpNote || (quote ? 'Follow up on the open estimate.' : 'No active task yet')}
                    </div>
                    <div className="mt-2 text-xs leading-5 text-[var(--app-muted)]">
                      {lead.followUpDate ? `Follow up on ${formatDate(lead.followUpDate)}.` : 'Set a follow-up date below.'}
                    </div>
                  </div>
                )}

                <div className="rounded-[8px] border border-[var(--app-line)] bg-white px-3 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--app-muted)]">Auto-Nudges</div>
                      <div className="mt-1 text-xs text-[var(--app-muted)]">
                        Business-hours only. Never more than one per lead per day. Suppressed after a recent rep touch or customer reply.
                      </div>
                    </div>
                    <div className="rounded-full bg-[var(--app-bg)] px-2.5 py-1 text-[10px] font-semibold text-[var(--app-muted)]">
                      {automationLoading ? 'Refreshing…' : `${automationJobs.length} scheduled`}
                    </div>
                  </div>

                  <div className="mt-3 grid gap-2">
                    {[
                      {
                        key: 'nudgeIfQuoteNotOpened' as const,
                        label: 'Nudge if quote not opened',
                        detail: 'After 3 business hours if the estimate has not been opened.',
                      },
                      {
                        key: 'nudgeIfSurveyNotCompleted' as const,
                        label: 'Nudge if survey not completed',
                        detail: 'Reminds the customer to finish the photo survey.',
                      },
                      {
                        key: 'nudgeIfQuoteViewedNoResponse' as const,
                        label: 'Nudge if quote viewed but no response',
                        detail: 'After 30 minutes if the quote was reviewed but no deposit or reply came in.',
                      },
                      {
                        key: 'nudgeBeforeQuoteExpires' as const,
                        label: 'Nudge before quote expires',
                        detail: 'Sends 48 hours before the estimate validity window runs out.',
                      },
                    ].map(item => {
                      const enabled = automationSettings[item.key]
                      const disabled = !canControlLeadAutomation || automationSavingKey === item.key

                      return (
                        <div key={item.key} className="flex items-center justify-between gap-3 rounded-[8px] border border-[var(--app-line)] bg-[var(--app-bg)] px-3 py-2.5">
                          <div>
                            <div className="text-sm font-medium text-[var(--app-ink)]">{item.label}</div>
                            <div className="mt-1 text-[11px] leading-5 text-[var(--app-muted)]">{item.detail}</div>
                          </div>
                          <button
                            type="button"
                            role="switch"
                            aria-checked={enabled}
                            disabled={disabled}
                            onClick={() => void updateLeadAutomationSettings({ [item.key]: !enabled } as Partial<LeadAutomationSettings>, item.key)}
                            className={`min-w-[64px] rounded-full px-3 py-1.5 text-[11px] font-semibold transition ${
                              enabled
                                ? 'bg-[var(--app-ink)] text-white'
                                : 'border border-[var(--app-line)] bg-white text-[var(--app-muted)]'
                            } disabled:opacity-50`}
                          >
                            {automationSavingKey === item.key ? 'Saving…' : enabled ? 'On' : 'Off'}
                          </button>
                        </div>
                      )
                    })}
                  </div>

                  {!canControlLeadAutomation ? (
                    <div className="mt-3 rounded-[8px] border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
                      Assign this lead to yourself or ask a manager to take ownership before changing auto-nudge rules.
                    </div>
                  ) : null}

                  <div className="mt-3">
                    <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--app-muted)]">Scheduled Nudges</div>
                    <div className="space-y-2">
                      {automationJobs.length > 0 ? (
                        automationJobs.map(job => (
                          <div key={job.id} className="flex items-center justify-between gap-3 rounded-[8px] border border-[var(--app-line)] bg-white px-3 py-2.5">
                            <div>
                              <div className="text-sm font-medium text-[var(--app-ink)]">{automationJobLabel(job)}</div>
                              <div className="mt-1 text-[11px] leading-5 text-[var(--app-muted)]">
                                Due {formatDateTime(job.dueAt)}{job.channel ? ` · ${job.channel.toUpperCase()}` : ''}
                              </div>
                            </div>
                            <button
                              type="button"
                              disabled={!canControlLeadAutomation || automationSavingKey === job.id}
                              onClick={() => void cancelLeadAutomationJob(job.id)}
                              className="rounded-[6px] border border-rose-200 bg-rose-50 px-2.5 py-1 text-[10px] font-semibold text-rose-700 hover:bg-rose-100 disabled:opacity-50"
                            >
                              {automationSavingKey === job.id ? 'Cancelling…' : 'Cancel'}
                            </button>
                          </div>
                        ))
                      ) : (
                        <div className="rounded-[8px] border border-dashed border-[var(--app-line)] bg-[var(--app-bg)] px-3 py-3 text-[11px] text-[var(--app-muted)]">
                          {automationLoading ? 'Loading scheduled nudges…' : 'No nudges are scheduled on this lead right now.'}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Follow-up date quick setter */}
                <div className="rounded-[8px] border border-[var(--app-line)] bg-white px-3 py-3">
                  <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--app-muted)]">
                    Follow-up {followUpDate ? `— ${formatDate(followUpDate)}` : '— not set'}
                  </div>
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {[
                      { label: 'Tomorrow', days: 1 },
                      { label: '+3 days', days: 3 },
                      { label: 'Next week', days: 7 },
                    ].map(({ label, days }) => (
                      <button
                        key={label}
                        disabled={!canHandleCurrentLeadCommunication}
                        onClick={() => {
                          const d = new Date(); d.setDate(d.getDate() + days)
                          setFollowUpDate(d.toISOString().slice(0, 10))
                        }}
                        className="rounded-[6px] border border-[var(--app-line)] bg-[var(--app-bg)] px-2.5 py-1 text-[10px] font-medium text-[var(--app-ink)] hover:border-[var(--app-accent)] hover:text-[var(--app-accent)] disabled:opacity-50"
                      >
                        {label}
                      </button>
                    ))}
                    {followUpDate && (
                      <button
                        disabled={!canHandleCurrentLeadCommunication}
                        onClick={() => setFollowUpDate('')}
                        className="rounded-[6px] border border-rose-200 bg-rose-50 px-2.5 py-1 text-[10px] font-medium text-rose-600 hover:bg-rose-100 disabled:opacity-50"
                      >
                        Clear
                      </button>
                    )}
                  </div>
                  <input
                    type="date"
                    value={followUpDate}
                    disabled={!canHandleCurrentLeadCommunication}
                    onChange={e => setFollowUpDate(e.target.value)}
                    className="crm-input text-xs w-full"
                  />
                </div>
              </div>
            </div>

            <div className="border-b border-[var(--app-line)] p-5">
              <div className="crm-label">Estimate Engagement</div>
              <div className="relative mt-5 pl-4 before:absolute before:bottom-0 before:left-[7px] before:top-1 before:w-px before:border-l before:border-dashed before:border-[rgba(228,226,220,1)]">
                {quoteEngagement.map((item, index) => (
                  <div key={item.label} className={`relative pl-4 text-sm ${index < quoteEngagement.length - 1 ? 'mb-5' : ''}`}>
                    <div className={`absolute left-[-3px] top-1 h-2 w-2 rounded-full ring-4 ring-white ${item.complete ? 'bg-[var(--app-accent)]' : 'bg-[rgba(228,226,220,1)]'}`} />
                    <div className="font-medium text-[var(--app-ink)]">{item.label}</div>
                    <div className="mt-1 text-[var(--app-muted)]">{item.value}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-4 p-5">
              <fieldset disabled={!canEditCurrentLead} className="space-y-4">
                <label className="block">
                  <span className="crm-label">Stage</span>
                  <select value={stage} onChange={event => setStage(event.target.value as CRMLead['stage'])} className="crm-input mt-2">
                    {SALES_LEAD_STAGES.map(item => (
                      <option key={item.id} value={item.id}>{item.label}</option>
                    ))}
                  </select>
                </label>

                <label className="block">
                  <span className="crm-label">Lead Context</span>
                  <select value={contextFlag} onChange={event => setContextFlag(event.target.value)} className="crm-input mt-2">
                    <option value="">— No flag —</option>
                    {LEAD_CONTEXT_FLAGS.map(item => (
                      <option key={item.id} value={item.id}>{item.label}</option>
                    ))}
                  </select>
                </label>

                {(stage === 'estimate_scheduled' || stage === 'estimate_completed') && (
                  <div>
                    <span className="crm-label">Estimate Appointment</span>
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <input type="date" value={estimateDate} onChange={e => setEstimateDate(e.target.value)} className="crm-input" placeholder="Date" />
                      <input type="time" value={estimateTime} onChange={e => setEstimateTime(e.target.value)} className="crm-input" placeholder="Time" />
                    </div>
                  </div>
                )}

                <label className="block">
                  <span className="crm-label">Follow-Up Date</span>
                  <input type="date" value={followUpDate} onChange={event => setFollowUpDate(event.target.value)} className="crm-input mt-2" />
                </label>

                <label className="block">
                  <span className="crm-label">Assigned Rep</span>
                  <select
                    value={assignedRepSelectValue}
                    disabled={!canReassignCurrentLead}
                    onChange={event => {
                      const nextUserId = event.target.value
                      const selected = assignmentOptions.find(user => user.id === nextUserId)
                      setAssignedRepUserId(nextUserId.startsWith('legacy:') ? '' : nextUserId)
                      setAssignedRep(selected?.name || '')
                    }}
                    className="crm-input mt-2"
                  >
                    <option value="">— Unassigned —</option>
                    {assignmentOptions.map(user => (
                      <option key={user.id} value={user.id}>{user.name}</option>
                    ))}
                  </select>
                </label>

                {/* Deposit section — visible when booked */}
                {isBookedLikeStage(lead.stage) && (
                  <div className="rounded-[10px] border border-[var(--app-line)] bg-[var(--app-bg)] px-3 py-3">
                    <span className="crm-label">Payment Status</span>
                    <div className="mt-2 text-sm font-semibold text-[var(--app-ink)]">
                      {lead.paymentStatus === 'paid_in_full'
                        ? 'Paid in full'
                        : lead.paymentStatus === 'deposit_received'
                          ? 'Deposit received'
                          : 'Deposit still required'}
                    </div>
                    <div className="mt-1 text-xs text-[var(--app-muted)]">
                      {lead.depositAmount
                        ? `${formatMoney(lead.depositAmount)}${lead.depositMethod ? ` via ${lead.depositMethod}` : ''}`
                        : 'Use the payment actions above to collect or log deposit activity.'}
                    </div>
                  </div>
                )}
              </fieldset>

              <div className={`rounded-[10px] border px-3 py-2.5 text-[11px] ${
                hasUnsavedChanges
                  ? 'border-amber-200 bg-amber-50 text-amber-800'
                  : 'border-dashed border-[var(--app-line)] bg-[var(--app-bg)] text-[var(--app-muted)]'
              }`}>
                {hasUnsavedChanges ? (
                  <>You have unsaved changes. Click <strong className="text-[var(--app-ink)]">Save Lead</strong> before leaving.</>
                ) : (
                  <>Changes on this lead save only when you click <strong className="text-[var(--app-ink)]">Save Lead</strong>.</>
                )}
              </div>
              <button onClick={() => void saveLead()} disabled={!canEditCurrentLead || saving} className="crm-button w-full justify-center disabled:opacity-60">
                {saving ? 'Saving...' : 'Save Lead'}
              </button>
              {canDeleteCurrentLead ? (
                <button onClick={() => void removeLead()} disabled={deleteBusy} className="crm-button w-full justify-center border-rose-200 text-rose-700 hover:bg-rose-50 disabled:opacity-60">
                  {deleteBusy ? 'Deleting...' : 'Delete Lead'}
                </button>
              ) : null}
              <button
                onClick={() => setIncidentOpen(true)}
                disabled={!canEditCurrentLead}
                className="crm-button w-full justify-center border-red-200 text-red-600 bg-white hover:bg-red-50"
              >
                ⚠ Log Incident
              </button>
            </div>
          </aside>

          <div className="order-3 flex flex-col lg:order-2 xl:order-2">
            {/* Tab bar */}
            <div className="flex items-center gap-1 border-b border-[var(--app-line)] bg-[var(--app-panel)] px-4 pt-3">
              <button
                onClick={() => setActiveTab('timeline')}
                className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 pb-3 pt-1 text-sm font-medium transition ${activeTab === 'timeline' ? 'border-[var(--app-accent)] text-[var(--app-accent)]' : 'border-transparent text-[var(--app-muted)] hover:text-[var(--app-ink)]'}`}
              >
                Timeline
              </button>
              {lead.email && (
                <button
                  onClick={() => { setActiveTab('emails'); setComposerChannel('email'); setComposerBody(''); if (lead.id) void fetchLeadEmails(lead.id) }}
                  className={`-mb-px flex items-center gap-2 border-b-2 px-3 pb-3 pt-1 text-sm font-medium transition ${activeTab === 'emails' ? 'border-[var(--app-accent)] text-[var(--app-accent)]' : 'border-transparent text-[var(--app-muted)] hover:text-[var(--app-ink)]'}`}
                >
                  Emails
                  {emailMessages.length > 0 && (
                    <span className="rounded-full bg-[rgba(34,72,56,0.1)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--app-accent)]">
                      {emailMessages.length}
                    </span>
                  )}
                </button>
              )}
              {lead.phone && (
                <button
                  onClick={() => setActiveTab('sms')}
                  className={`-mb-px flex items-center gap-2 border-b-2 px-3 pb-3 pt-1 text-sm font-medium transition ${activeTab === 'sms' ? 'border-[#f5a623] text-[#f5a623]' : 'border-transparent text-[var(--app-muted)] hover:text-[var(--app-ink)]'}`}
                >
                  💬 SMS
                  {smsMessages.filter(m => m.direction === 'inbound').length > 0 && (
                    <span className="rounded-full px-1.5 py-0.5 text-[10px] font-semibold text-white" style={{ background: '#f5a623' }}>
                      {smsMessages.filter(m => m.direction === 'inbound').length}
                    </span>
                  )}
                </button>
              )}
            </div>
            {activeTab === 'timeline' && (
            <LeadTimeline
              lead={lead}
              quote={quote}
              timeline={timeline}
              readOnly={!canHandleCurrentLeadCommunication}
              inventoryCubicFeet={inventoryMetrics.totalCubicFeet}
              activityType={activityType}
              activityNotes={activityNotes}
              loggingActivity={loggingActivity}
              consultationActive={consultationActive}
              consultationSaving={consultationSaving}
              consultationNotes={consultationNotes}
              consultationSummary={consultationSummary}
              consultationSeconds={consultationSeconds}
              onActivityTypeChange={setActivityType}
              onActivityNotesChange={setActivityNotes}
              onLogActivity={() => void logActivity()}
              onOpenQuoteBuilder={() => void openQuoteBuilder()}
              onStartConsultation={() => void startConsultation()}
              onConsultationNotesChange={setConsultationNotes}
              onConsultationSummaryChange={setConsultationSummary}
              onStopConsultation={() => void stopConsultation()}
              onLeadUpdate={setLead}
              onNoteAdded={mergeFollowUpLog}
            />
            )}
            {activeTab === 'emails' && (
              <div className="flex h-full flex-col overflow-hidden">
                {/* Email thread header */}
                <div className="flex items-center justify-between border-b border-[var(--app-line)] bg-[var(--app-panel)] px-5 py-3">
                  <div>
                    <div className="text-sm font-semibold text-[var(--app-ink)]">Email Thread</div>
                    <div className="text-xs text-[var(--app-muted)]">{lead.email}</div>
                  </div>
                  <button
                    onClick={() => openComposer('email')}
                    className="crm-button-dark text-xs"
                  >
                    ✉️ Compose
                  </button>
                </div>

                {/* Email list */}
                {emailsLoading ? (
                  <div className="flex flex-1 items-center justify-center p-8 text-sm text-[var(--app-muted)]">Loading emails…</div>
                ) : emailMessages.length === 0 ? (
                  <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
                    <div className="text-3xl">✉️</div>
                    <div className="text-sm font-medium text-[var(--app-ink)]">No emails yet</div>
                    <div className="text-xs text-[var(--app-muted)]">Emails sent and received from {lead.email} will appear here.</div>
                    <button onClick={() => openComposer('email')} className="crm-button-dark mt-1 text-xs">Send First Email</button>
                  </div>
                ) : (
                  <div className="flex-1 overflow-y-auto divide-y divide-[var(--app-line)]">
                    {emailMessages.map((msg, idx) => (
                      <div key={msg.id} className={`px-5 py-4 ${msg.direction === 'inbound' ? 'bg-[rgba(245,166,35,0.04)]' : 'bg-[var(--app-panel)]'}`}>
                        <div className="flex items-start gap-3">
                          {/* Avatar */}
                          <div className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white ${msg.direction === 'inbound' ? 'bg-[var(--app-ink)]' : 'bg-[var(--app-accent)]'}`}>
                            {msg.direction === 'inbound' ? (lead.name?.slice(0, 1) || msg.from.slice(0, 1)).toUpperCase() : 'S'}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-semibold text-[var(--app-ink)]">
                                  {msg.direction === 'inbound' ? (lead.name || msg.from) : 'Saturn Star Movers'}
                                </span>
                                {idx === 0 && msg.direction === 'inbound' && (
                                  <span className="rounded-[4px] border border-[var(--app-warm)] bg-[rgba(245,166,35,0.1)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--app-warm)]">New</span>
                                )}
                              </div>
                              <span className="shrink-0 text-xs text-[var(--app-muted)]">
                                {new Date(msg.sentAt).toLocaleString('en-CA', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                              </span>
                            </div>
                            <div className="mt-0.5 text-xs text-[var(--app-muted)] truncate">{msg.subject}</div>
                            <div className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[var(--app-ink)]">{msg.body}</div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Inline compose — always visible at bottom of email thread */}
                <div className="shrink-0 border-t border-[var(--app-line)] bg-[var(--app-panel)] px-5 py-3 space-y-2">
                  <input
                    value={composerChannel === 'email' ? composerSubject : (() => {
                      const lastInbound = emailMessages.find(e => e.direction === 'inbound')
                      return lastInbound ? `Re: ${lastInbound.subject}` : 'Following up — Saturn Star Moving'
                    })()}
                    onChange={e => { setComposerChannel('email'); setComposerSubject(e.target.value) }}
                    onFocus={() => { if (!composerSubject) { const last = emailMessages.find(e => e.direction === 'inbound'); setComposerSubject(last ? `Re: ${last.subject}` : 'Following up — Saturn Star Moving'); setComposerChannel('email') } }}
                    className="w-full rounded-[8px] border border-[var(--app-line)] bg-[var(--app-bg)] px-3 py-2 text-xs text-[var(--app-ink)] focus:border-[var(--app-accent)] focus:outline-none"
                    placeholder="Subject…"
                    disabled={!canHandleCurrentLeadCommunication}
                  />
                  <textarea
                    value={composerChannel === 'email' ? composerBody : ''}
                    onChange={e => { composerUserEdited.current = true; setComposerChannel('email'); setComposerBody(e.target.value) }}
                    onFocus={() => { if (composerChannel !== 'email') { setComposerChannel('email'); if (!composerBody) void runSmartCompose('email', lead) } }}
                    className="w-full resize-none rounded-[8px] border border-[var(--app-line)] bg-[var(--app-bg)] px-3 py-2 text-sm text-[var(--app-ink)] focus:border-[var(--app-accent)] focus:outline-none"
                    placeholder="Write a reply…"
                    rows={3}
                    disabled={!canHandleCurrentLeadCommunication}
                  />
                  <div className="flex items-center justify-between gap-2">
                    <button
                      onClick={() => { composerUserEdited.current = false; setComposerChannel('email'); void runSmartCompose('email', lead) }}
                      disabled={!canHandleCurrentLeadCommunication || scBusy}
                      className="text-xs text-[var(--app-muted)] hover:text-[var(--app-accent)] disabled:opacity-40"
                    >
                      {scBusy ? '✨ Drafting…' : '✨ AI Draft'}
                    </button>
                    <button
                      onClick={() => { setComposerChannel('email'); void sendComposerMessage() }}
                      disabled={!canHandleCurrentLeadCommunication || composerBusy || !composerBody.trim() || composerChannel !== 'email'}
                      className="rounded-[8px] bg-[var(--app-ink)] px-4 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-40"
                    >
                      {composerBusy ? 'Sending…' : 'Send Email'}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* ── SMS Thread Tab ───────────────────────────────────── */}
            {activeTab === 'sms' && (
              <div className="flex h-full flex-col overflow-hidden">
                {/* Header */}
                <div className="flex items-center justify-between border-b border-[var(--app-line)] bg-[var(--app-panel)] px-5 py-3">
                  <div>
                    <div className="text-sm font-semibold" style={{ color: '#1a2744' }}>SMS Conversation</div>
                    <div className="text-xs text-[var(--app-muted)]">
                      {lead.phone}
                      {leadPreferredBranchLabel ? ` • replying as ${leadPreferredBranchLabel}` : ''}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => lead.phone && void fetchLeadSms(lead.phone, true)}
                      className="rounded-lg border border-[var(--app-line)] bg-[var(--app-bg)] px-3 py-1.5 text-xs text-[var(--app-muted)] hover:text-[var(--app-ink)] transition-colors"
                      disabled={smsLoading}
                    >
                      {smsLoading ? '…' : '↺ Sync'}
                    </button>
                    <button
                      onClick={() => openComposer('sms')}
                      className="rounded-lg px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90"
                      style={{ background: '#1a2744' }}
                    >
                      ✨ AI Draft
                    </button>
                  </div>
                </div>

                {/* Messages area */}
                <div ref={smsAreaRef} className="flex-1 overflow-y-auto px-4 py-4" style={{ background: '#f9fafb' }}>
                  {smsLoading && smsMessages.length === 0 ? (
                    <div className="flex h-full items-center justify-center text-sm text-[var(--app-muted)]">Loading messages…</div>
                  ) : smsMessages.length === 0 ? (
                    <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
                      <div className="text-4xl">💬</div>
                      <div className="text-sm font-semibold" style={{ color: '#1a2744' }}>No messages yet</div>
                      <div className="text-xs text-[var(--app-muted)]">Send the first message to {lead.name || lead.phone} below.</div>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-2">
                      {smsMessages.map((msg) => {
                        const isOut = msg.direction === 'outbound'
                        const branchLabel = getSaturnBranchLabel(getSaturnBusinessNumberFromSmsMessage(msg))
                        // Twilio WhatsApp SIDs start with WA; SMS SIDs start with SM
                        const isWhatsApp = msg.twilio_sid?.startsWith('WA') ?? false
                        return (
                          <div key={msg.id} className={`flex flex-col ${isOut ? 'items-end' : 'items-start'}`}>
                            <div
                              className="max-w-[75%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed"
                              style={isOut
                                ? { background: isWhatsApp ? '#25D366' : '#1a2744', color: 'white', borderBottomRightRadius: '4px' }
                                : { background: 'white', color: '#1a2744', border: '1px solid #e5e7eb', borderBottomLeftRadius: '4px' }}
                            >
                              {msg.body}
                            </div>
                            <div className="mt-0.5 px-1 text-[10px] text-[var(--app-muted)]">
                              {isWhatsApp && <span className="mr-1 text-[#25D366]">WhatsApp ·</span>}
                              {new Date(msg.created_at).toLocaleString('en-CA', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                              {branchLabel ? ` • ${branchLabel}` : ''}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>

                {/* Compose */}
                <div className="border-t border-[var(--app-line)] bg-[var(--app-panel)] px-4 py-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    {leadPreferredBranchLabel ? (
                      <div className="text-xs text-[var(--app-muted)]">
                        From <span className="font-semibold text-[var(--app-ink)]">{leadPreferredBranchLabel}</span>
                      </div>
                    ) : <div />}
                    {/* Channel toggle */}
                    <div className="flex items-center gap-1 rounded-lg border border-[var(--app-line)] bg-[var(--app-bg)] p-0.5">
                      <button
                        type="button"
                        onClick={() => setSmsChannel('sms')}
                        className={`rounded-md px-2.5 py-1 text-[10px] font-semibold transition ${smsChannel === 'sms' ? 'bg-[#1a2744] text-white' : 'text-[var(--app-muted)]'}`}
                      >
                        SMS
                      </button>
                      <button
                        type="button"
                        onClick={() => setSmsChannel('whatsapp')}
                        className={`rounded-md px-2.5 py-1 text-[10px] font-semibold transition ${smsChannel === 'whatsapp' ? 'bg-[#25D366] text-white' : 'text-[var(--app-muted)]'}`}
                      >
                        WhatsApp
                      </button>
                    </div>
                  </div>
                  <div className="flex items-end gap-2">
                    <textarea
                      value={smsInput}
                      onChange={e => setSmsInput(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault()
                          if (!smsSending && smsInput.trim() && lead.phone) {
                            const body = smsInput.trim()
                            setSmsInput('')
                            setSmsSending(true)
                            void sendSalesMessage({ channel: smsChannel, to: lead.phone, body, leadId: lead.id, fromNumber: leadPreferredBranchNumber })
                              .then((result) => {
                                setSmsMessages(prev => [...prev, {
                                  id: `local_${Date.now()}`,
                                  from_number: result.result?.fromNumber || getDefaultSaturnBranchNumber(),
                                  to_number: lead.phone!,
                                  body,
                                  direction: 'outbound',
                                  lead_id: lead.id ?? null,
                                  created_at: new Date().toISOString(),
                                }])
                                setTimeout(() => {
                                  if (smsAreaRef.current) smsAreaRef.current.scrollTop = smsAreaRef.current.scrollHeight
                                }, 40)
                              })
                              .finally(() => setSmsSending(false))
                          }
                        }
                      }}
                      placeholder={`Message ${lead.name?.split(' ')[0] || lead.phone}…`}
                      rows={1}
                      disabled={!canHandleCurrentLeadCommunication || smsSending}
                      className="flex-1 resize-none rounded-xl border border-[var(--app-line)] bg-[var(--app-bg)] px-3 py-2.5 text-sm text-[var(--app-ink)] placeholder:text-[var(--app-muted)] focus:outline-none focus:ring-1"
                      style={{ maxHeight: '120px', overflowY: 'auto', ['--tw-ring-color' as string]: '#f5a623' }}
                      onInput={e => { const el = e.currentTarget; el.style.height = 'auto'; el.style.height = `${el.scrollHeight}px` }}
                    />
                    <button
                      disabled={!canHandleCurrentLeadCommunication || smsSending || !smsInput.trim()}
                      onClick={() => {
                        if (!smsSending && smsInput.trim() && lead.phone) {
                          const body = smsInput.trim()
                          setSmsInput('')
                          setSmsSending(true)
                          void sendSalesMessage({ channel: smsChannel, to: lead.phone, body, leadId: lead.id, fromNumber: leadPreferredBranchNumber })
                            .then((result) => {
                              setSmsMessages(prev => [...prev, {
                                id: `local_${Date.now()}`,
                                from_number: result.result?.fromNumber || getDefaultSaturnBranchNumber(),
                                to_number: lead.phone!,
                                body,
                                direction: 'outbound',
                                lead_id: lead.id ?? null,
                                created_at: new Date().toISOString(),
                              }])
                              setTimeout(() => {
                                if (smsAreaRef.current) smsAreaRef.current.scrollTop = smsAreaRef.current.scrollHeight
                              }, 40)
                            })
                            .finally(() => setSmsSending(false))
                        }
                      }}
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white transition-opacity disabled:opacity-40"
                      style={{ background: smsSending ? '#ccc' : '#f5a623' }}
                    >
                      {smsSending ? (
                        <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="32" strokeDashoffset="12" /></svg>
                      ) : (
                        <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4"><path d="M2 21l21-9L2 3v7l15 2-15 2v7z"/></svg>
                      )}
                    </button>
                  </div>
                  <div className="mt-1.5 text-[10px] text-[var(--app-muted)]">Enter to send · Shift+Enter for new line · ✨ AI Draft for a smart opener</div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {composerOpen ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 p-0 md:items-center md:p-4">
          <div className="max-h-[92vh] w-full overflow-y-auto rounded-t-[14px] border border-[var(--app-line)] bg-[var(--app-panel)] shadow-2xl md:max-w-2xl md:rounded-[10px]">
            <div className="flex items-center justify-between border-b border-[var(--app-line)] px-4 py-4 md:px-5">
              <div>
                <div className="crm-label">{composerChannel === 'sms' ? 'SMS Composer' : 'Email Composer'}</div>
                <div className="mt-1 text-sm text-[var(--app-muted)]">
                  Sending to {composerChannel === 'sms' ? lead?.phone || 'No phone' : lead?.email || 'No email'}
                </div>
              </div>
              <button onClick={() => setComposerOpen(false)} className="crm-button">Close</button>
            </div>
            <div className="space-y-4 px-4 py-5 md:px-5">
              {composerChannel === 'email' ? (
                <input
                  value={composerSubject}
                  onChange={event => setComposerSubject(event.target.value)}
                  disabled={!canHandleCurrentLeadCommunication}
                  className="crm-input"
                  placeholder="Email subject"
                />
              ) : null}
              <textarea
                value={composerBody}
                onChange={event => { composerUserEdited.current = true; setComposerBody(event.target.value) }}
                disabled={!canHandleCurrentLeadCommunication}
                className={`crm-input min-h-56 transition-opacity ${scBusy ? 'opacity-50' : 'opacity-100'}`}
                placeholder={composerChannel === 'sms' ? 'Type your SMS...' : 'Type your email...'}
              />
            </div>
            <div className="flex flex-col-reverse gap-3 border-t border-[var(--app-line)] px-4 py-4 md:flex-row md:items-center md:justify-between md:px-5">
              <button
                onClick={() => { composerUserEdited.current = false; void runSmartCompose(composerChannel, lead) }}
                disabled={!canHandleCurrentLeadCommunication || scBusy}
                className="text-sm text-[var(--app-muted)] hover:text-[var(--app-accent)] disabled:opacity-40 transition-colors"
              >
                {scBusy ? '✨ AI drafting...' : '✨ Regenerate'}
              </button>
              <div className="flex flex-col-reverse gap-3 md:flex-row md:items-center">
                <button onClick={() => setComposerOpen(false)} className="crm-button w-full md:w-auto">Cancel</button>
                <button onClick={() => void sendComposerMessage()} disabled={!canHandleCurrentLeadCommunication || composerBusy || !composerBody.trim()} className="crm-button-dark disabled:opacity-60">
                  {composerBusy ? 'Sending...' : composerChannel === 'sms' ? 'Send SMS' : 'Send Email'}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {showUnsavedLeaveModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-[16px] border border-[var(--app-line)] bg-white p-6 shadow-2xl">
            <h2 className="font-display text-lg font-semibold text-[var(--app-ink)]">Save this lead before leaving?</h2>
            <p className="mt-2 text-sm leading-6 text-[var(--app-muted)]">
              You have unsaved changes on <strong className="text-[var(--app-ink)]">{lead?.name || 'this lead'}</strong>. Save them now so nothing slips through the cracks.
            </p>
            <div className="mt-5 flex flex-col gap-3">
              <button
                onClick={() => void handleSaveAndLeave()}
                disabled={unsavedLeaveBusy}
                className="crm-button-dark w-full justify-center disabled:opacity-60"
              >
                {unsavedLeaveBusy ? 'Saving...' : 'Save Lead And Leave'}
              </button>
              <button
                onClick={handleDiscardAndLeave}
                disabled={unsavedLeaveBusy}
                className="crm-button w-full justify-center border-amber-200 text-amber-700 hover:bg-amber-50 disabled:opacity-60"
              >
                Leave Without Saving
              </button>
              <button
                onClick={handleStayOnLead}
                disabled={unsavedLeaveBusy}
                className="text-sm font-medium text-[var(--app-muted)] hover:text-[var(--app-ink)] disabled:opacity-60"
              >
                Stay Here
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* ── Lost Reason Modal ────────────────────────────────────── */}
      {showLostModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-[16px] border border-[var(--app-line)] bg-white p-6 shadow-2xl">
            <h2 className="font-display text-lg font-semibold text-[var(--app-ink)]">Why was this lead lost?</h2>
            <p className="mt-1 text-xs text-[var(--app-muted)]">Select a reason below — the lead won&apos;t be moved until you click &quot;Mark as Lost&quot;.</p>
            <p className="mt-1 text-sm text-[var(--app-muted)]">Required before marking as lost. Helps improve your close rate over time.</p>
            <div className="mt-4 grid grid-cols-2 gap-2">
              {LOST_REASONS.map(reason => (
                <button
                  key={reason.id}
                  onClick={() => setLostReason(reason.id)}
                  className={`rounded-[10px] border px-3 py-2.5 text-sm font-medium text-left transition ${lostReason === reason.id ? 'border-rose-400 bg-rose-50 text-rose-700' : 'border-[var(--app-line)] bg-[var(--app-bg)] text-[var(--app-ink)] hover:border-rose-300'}`}
                >
                  {reason.label}
                </button>
              ))}
            </div>
            <textarea
              value={lostNotes}
              onChange={e => setLostNotes(e.target.value)}
              className="mt-3 min-h-[72px] w-full resize-none rounded-[10px] border border-[var(--app-line)] bg-[var(--app-bg)] px-3 py-2.5 text-sm outline-none"
              placeholder="Optional notes (what they said, what we could improve)..."
            />
            <div className="mt-4 flex items-center justify-end gap-3">
              <button onClick={() => { setShowLostModal(false); setStage(lead?.stage || 'new') }} className="crm-button text-sm">Cancel</button>
              <button
                onClick={() => void handleConfirmLost()}
                disabled={!lostReason}
                className="crm-button-dark text-sm disabled:opacity-50"
              >
                Mark as Lost
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* ── Photo Request Dialog ──────────────────────────────────── */}
      {showPhotoRequestDialog && photoRequestData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-[16px] border border-[var(--app-line)] bg-white p-6 shadow-2xl">
            <h2 className="font-display text-base font-semibold text-[var(--app-ink)]">📷 Send photo request</h2>
            <p className="mt-1 text-xs text-[var(--app-muted)]">Review and edit the message before sending. The upload link is already included.</p>
            <div className="mt-3 rounded-[8px] border border-[var(--app-line)] bg-[var(--app-bg)] px-3 py-2 text-xs text-[var(--app-muted)] break-all">
              🔗 {photoRequestData.surveyUrl}
            </div>
            <textarea
              value={photoRequestSmsBody}
              onChange={e => setPhotoRequestSmsBody(e.target.value)}
              className="mt-3 w-full rounded-[10px] border border-[var(--app-line)] bg-[var(--app-bg)] px-3 py-2.5 text-sm outline-none focus:border-[var(--app-accent)] resize-none"
              rows={5}
            />
            <div className="mt-4 flex items-center justify-end gap-3">
              <button
                onClick={() => { setShowPhotoRequestDialog(false) }}
                className="crm-button text-sm"
              >
                Skip SMS
              </button>
              <button
                onClick={() => void sendPhotoRequestSms()}
                disabled={photoRequestSending || !photoRequestSmsBody.trim()}
                className="crm-button-dark text-sm disabled:opacity-60"
              >
                {photoRequestSending ? 'Sending…' : `Send to ${lead?.phone}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Dispatch Brief Modal ───────────────────────────────────── */}
      {dispatchBriefOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
          <div className="flex w-full max-w-2xl flex-col rounded-[16px] border border-[var(--app-line)] bg-white shadow-2xl" style={{ maxHeight: '85vh' }}>
            <div className="flex items-center justify-between border-b border-[var(--app-line)] px-5 py-4">
              <div>
                <h2 className="font-display text-base font-semibold text-[var(--app-ink)]">📋 Crew Briefing</h2>
                <p className="text-xs text-[var(--app-muted)]">Generated from calls, quote, and notes. Share with crew before dispatch.</p>
              </div>
              <div className="flex items-center gap-2">
                {!dispatchBriefBusy && dispatchBriefText && (
                  <button
                    onClick={() => void navigator.clipboard.writeText(dispatchBriefText)}
                    className="crm-button text-xs"
                  >
                    Copy
                  </button>
                )}
                <button onClick={() => setDispatchBriefOpen(false)} className="crm-button text-xs">Close</button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4">
              {dispatchBriefBusy ? (
                <div className="flex items-center gap-3 py-8 text-sm text-[var(--app-muted)]">
                  <span className="block h-4 w-4 animate-spin rounded-full border-2 border-[var(--app-accent)] border-t-transparent" />
                  Generating crew briefing from all available context…
                </div>
              ) : (
                <pre className="whitespace-pre-wrap font-sans text-sm leading-7 text-[var(--app-ink)]">{dispatchBriefText}</pre>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Appointment SMS Confirm Modal ─────────────────────────── */}
      {showConsultationModal && lead && (
        <ConsultationBookingModal
          lead={lead}
          salesUsers={salesUsers}
          onClose={() => setShowConsultationModal(false)}
          onConfirm={data => void handleBookConsultation(data)}
        />
      )}

      {showApptSmsModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-[16px] border border-[var(--app-line)] bg-white p-6 shadow-2xl">
            <h2 className="font-display text-base font-semibold text-[var(--app-ink)]">Send appointment confirmation SMS?</h2>
            <p className="mt-2 text-sm text-[var(--app-muted)]">
              {`"Hi ${lead?.name?.split(' ')[0] || 'there'}! This is Saturn Star Moving — just confirming your in-home estimate${lead?.estimateDate ? ` for ${new Date(lead.estimateDate + 'T12:00:00').toLocaleDateString('en-CA', { weekday: 'long', month: 'long', day: 'numeric' })}` : ''}. We'll take a look at your items and put together your personalized quote on the spot. Any questions, call or text us at 226-773-2993. See you soon! 🌟"`}
            </p>
            <div className="mt-5 flex items-center justify-end gap-3">
              <button onClick={() => void handleApptSmsConfirm(false)} className="crm-button text-sm">Skip SMS</button>
              <button onClick={() => void handleApptSmsConfirm(true)} className="crm-button-dark text-sm">Send SMS</button>
            </div>
          </div>
        </div>
      ) : null}

      {/* ── Confirm Job Modal ─────────────────────────────────────── */}
      {showConfirmJobModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(15,27,56,0.55)', backdropFilter: 'blur(2px)' }}>
          <div className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl">
            {/* Navy header */}
            <div className="relative bg-[#1a2744] px-6 py-5">
              <div className="absolute inset-x-0 bottom-0 h-[2px] bg-[#f5a623]" />
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="text-base font-bold text-white">Confirm Job — {lead?.name}</h2>
                  <p className="mt-0.5 text-xs text-slate-300">Deposit required to lock in this booking.</p>
                </div>
                <button onClick={closeConfirmJobModal} className="ml-4 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-slate-400 hover:bg-white/10 hover:text-white transition-colors">✕</button>
              </div>
            </div>

            <div className="space-y-4 px-6 py-5">
              {/* Deposit already received — skip form */}
              {lead?.paymentStatus === 'deposit_received' || lead?.paymentStatus === 'paid_in_full' ? (
                <div className="flex items-center gap-3 rounded-xl bg-emerald-50 p-4 ring-1 ring-emerald-200">
                  <span className="text-2xl">✅</span>
                  <div>
                    <div className="text-sm font-semibold text-emerald-800">Deposit already received</div>
                    <div className="text-xs text-emerald-600 mt-0.5">{formatMoney(lead.depositAmount || 0)} via {lead.depositMethod}</div>
                  </div>
                </div>
              ) : (
                <>
                  {/* Deposit gate notice */}
                  <div className="flex items-start gap-3 rounded-xl bg-amber-50 p-4 ring-1 ring-amber-200">
                    <span className="text-lg mt-0.5">⚠️</span>
                    <div className="text-sm text-amber-800">
                      <strong>Deposit required.</strong> No job moves to Booked without a confirmed deposit. Collect it now or use the Collect Card / Send Link options on the lead.
                    </div>
                  </div>
                  <label className="block">
                    <span className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">Deposit Amount</span>
                    <input
                      type="number"
                      value={confirmJobDeposit}
                      onChange={e => setConfirmJobDeposit(e.target.value)}
                      className="crm-input mt-1.5 w-full"
                      placeholder={quote ? `${formatMoney(quote.deposit)} (20% of total)` : 'e.g. 400'}
                    />
                  </label>
                  <label className="block">
                    <span className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">Payment Method</span>
                    <select value={confirmJobDepositMethod} onChange={e => setConfirmJobDepositMethod(e.target.value)} className="crm-input mt-1.5 w-full">
                      {DEPOSIT_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </label>
                </>
              )}

              {/* Confirmation recipients */}
              <div className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-600 ring-1 ring-slate-100">
                Booking confirmation → {lead?.phone ? <strong className="text-[#1a2744]">{lead.phone}</strong> : null}
                {lead?.phone && lead?.email ? ' & ' : null}
                {lead?.email ? <strong className="text-[#1a2744]">{lead.email}</strong> : null}
                {!lead?.phone && !lead?.email ? <span className="text-red-500">No contact info — add phone or email first</span> : null}
              </div>
            </div>

            <div className="flex gap-2.5 border-t border-slate-100 px-6 py-4">
              <button onClick={closeConfirmJobModal} className="flex-1 rounded-xl border border-slate-200 bg-white py-2.5 text-sm font-medium text-slate-500 hover:bg-slate-50 transition-colors">Cancel</button>
              <button
                onClick={() => void handleConfirmJob()}
                disabled={
                  confirmJobBusy ||
                  (lead?.paymentStatus !== 'deposit_received' && lead?.paymentStatus !== 'paid_in_full' && !confirmJobDeposit)
                }
                className="flex-1 rounded-xl bg-[#1a2744] py-2.5 text-sm font-semibold text-white hover:bg-[#243460] disabled:opacity-40 transition-colors"
              >
                {confirmJobBusy ? 'Confirming…' : 'Confirm Booking'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* ── Incident Modal ────────────────────────────────────────── */}
      {incidentOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md overflow-hidden rounded-[16px] border border-[var(--app-line)] bg-white shadow-2xl">
            <div className="border-b border-[var(--app-line)] bg-[#1a2744] px-6 py-4">
              <h2 className="font-display text-base font-semibold text-white">Log Incident</h2>
              <div className="mt-1 h-0.5 w-10 bg-[#f5a623]" />
            </div>
            <div className="space-y-4 px-6 py-5">
              <div>
                <div className="crm-label mb-2">Incident Type</div>
                <div className="flex flex-wrap gap-2">
                  {([
                    { id: 'damage', label: 'Damage' },
                    { id: 'lost_item', label: 'Lost Item' },
                    { id: 'complaint', label: 'Customer Complaint' },
                    { id: 'delay', label: 'Delay' },
                    { id: 'other', label: 'Other' },
                  ] as const).map(opt => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setIncidentType(opt.id)}
                      className={incidentType === opt.id
                        ? 'rounded-full bg-[#1a2744] px-3 py-1 text-xs font-semibold text-white'
                        : 'rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-600 hover:border-[#1a2744] transition'}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
              <label className="block">
                <span className="crm-label">Description</span>
                <textarea
                  value={incidentDesc}
                  onChange={e => setIncidentDesc(e.target.value)}
                  className="crm-input mt-2 min-h-24 w-full resize-none"
                  placeholder="Describe what happened in detail..."
                />
              </label>
            </div>
            <div className="flex items-center justify-end gap-3 border-t border-[var(--app-line)] px-6 py-4">
              <button onClick={() => { setIncidentOpen(false); setIncidentDesc('') }} className="crm-button text-sm">Cancel</button>
              <button
                onClick={() => void logIncident()}
                disabled={incidentBusy || !incidentDesc.trim()}
                className="rounded-[10px] bg-red-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-red-700 disabled:opacity-60"
              >
                {incidentBusy ? 'Logging...' : 'Log Incident'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <FastLaneModal
        open={fastLaneOpen}
        lead={lead}
        onClose={() => setFastLaneOpen(false)}
        onBooked={updatedLead => { applyLeadSnapshot(updatedLead, { hydrateForm: true }); setFastLaneOpen(false) }}
      />

      <EstimateDraftModal
        open={quoteModalOpen}
        quote={quote}
        lead={lead}
        inventory={inventory}
        branch={branch}
        originAddress={originAddress}
        originCity={originCity}
        destCity={destCity}
        destAddress={destAddress}
        recalculateBusy={recalculateBusy}
        listingPhotos={listingPhotos}
        activePhotoIndex={activePhotoIndex}
        inventoryMetrics={inventoryMetrics}
        groupedInventory={groupedInventory}
        presetMatches={presetMatches}
        quoteLineItems={quoteLineItems}
        quoteDiscountAmount={quoteDiscountAmount}
        quoteDiscountLabel={quoteDiscountLabel}
        quoteModalTotals={quoteModalTotals}
        quoteModalBusy={quoteModalBusy}
        jobFactors={jobFactors}
        moveDescription={quoteMoveDescription}
        internalNotes={quoteInternalNotes}
        onMoveDescriptionChange={v => { setQuoteMoveDescription(v); setQuoteModalDirty(true) }}
        onInternalNotesChange={v => { setQuoteInternalNotes(v); setQuoteModalDirty(true) }}
        onClose={() => void closeQuoteModal()}
        onRecalculate={handleModalRecalculate}
        onAddLineItem={addQuoteLineItem}
        onSetActivePhotoIndex={setActivePhotoIndex}
        onAddPreset={addPresetItem}
        onQuoteDiscountAmountChange={value => { setQuoteDiscountAmount(value); setQuoteModalDirty(true) }}
        onQuoteDiscountLabelChange={value => { setQuoteDiscountLabel(value); setQuoteModalDirty(true) }}
        onUpdateLineItem={updateQuoteLineItem}
        onRemoveLineItem={removeQuoteLineItem}
        onSetLineItems={setQuoteLineItems}
        onSaveDraft={options => void saveQuoteDraft(options)}
        onSaveAndPreview={options => void saveAndPreviewQuote(options)}
        onBranchChange={setBranch}
        onJobFactorsChange={setJobFactors}
        onOriginAddressChange={setOriginAddress}
        onOriginCityChange={setOriginCity}
        onDestAddressChange={setDestAddress}
        onDestCityChange={setDestCity}
        onAddInventoryItems={items => setInventory(current => [...current, ...items])}
        onUpdateInventoryItem={updateInventoryItem}
        onToggleInventoryItem={toggleInventoryItem}
        onRemoveInventoryItem={removeInventoryItem}
      />

      <CollectCardModal
        open={collectCardOpen}
        lead={lead}
        quote={quote}
        onClose={() => setCollectCardOpen(false)}
        onSuccess={({ lead: updatedLead, depositCharged, cardLast4, cardBrand }) => {
          setLead(updatedLead)
          setCollectCardOpen(false)
          if (depositCharged) {
            setError(null)
            // Send receipt email after card deposit
            if (updatedLead.email && quote) {
              void fetch('/api/sales/deposit-receipt', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                  toEmail: updatedLead.email,
                  toName: updatedLead.name,
                  quoteNumber: quote.number,
                  moveDate: quote.moveDate,
                  originCity: quote.originCity,
                  destCity: quote.destCity,
                  depositAmount: quote.deposit,
                  balanceAmount: quote.balance,
                  totalAmount: quote.total,
                  paymentMethod: 'Credit Card',
                  cardLast4,
                }),
              }).catch(() => null)
            }
          }
        }}
      />
    </div>
  )
}
