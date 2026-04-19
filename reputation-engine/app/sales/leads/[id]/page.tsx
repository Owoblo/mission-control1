'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { EstimateDraftModal } from '@/app/components/sales/lead-detail/estimate-draft-modal'
import { CollectCardModal } from '@/app/components/sales/collect-card-modal'
import { LeadBasicsPanel } from '@/app/components/sales/lead-detail/lead-basics-panel'
import { LeadTimeline } from '@/app/components/sales/lead-detail/lead-timeline'
import {
  DEFAULT_ROOM_OPTIONS,
  buildLeadSignature,
  buildRoomBreakdown,
  normalizeRoomName,
} from '@/app/components/sales/lead-detail/helpers'
import { InventoryRoomSection } from '@/app/components/sales/lead-detail/inventory-room-section'
import { INVENTORY_PRESETS, createInventoryItemFromPreset } from '@/lib/item-presets'
import { DEPOSIT_METHODS, LEAD_CONTEXT_FLAGS, LOST_REASONS, SALES_LEAD_STAGES, computeQuoteTotals, deriveInventoryMetrics, estimateLeadQuote, formatDate, formatDateTime, formatMoney } from '@/lib/sales'
import { confirmJob, createLeadQuote, deleteSalesLead, enrichSalesAddress, fetchSalesLead, fetchSalesOverview, fetchSalesQuote, saveLeadConsultation, saveSalesFollowUp, sendSalesMessage, updateSalesLead, updateSalesQuote } from '@/lib/sales-api'
import type { CRMLead, CRMQuote, EstimateRouteContext, FollowUpLog, InventoryItem, JobFactors, QuoteLineItem } from '@/lib/types'

export default function SalesLeadDetailPage() {
  const params = useParams() as { id?: string }
  const router = useRouter()
  const searchParams = useSearchParams()
  const [lead, setLead] = useState<CRMLead | null>(null)
  const [quote, setQuote] = useState<CRMQuote | null>(null)
  const [followUps, setFollowUps] = useState<FollowUpLog[]>([])
  const [stage, setStage] = useState<CRMLead['stage']>('new')
  const [followUpDate, setFollowUpDate] = useState('')
  const [leadName, setLeadName] = useState('')
  const [leadPhone, setLeadPhone] = useState('')
  const [leadEmail, setLeadEmail] = useState('')
  const [moveDate, setMoveDate] = useState('')
  const [moveDateFlexible, setMoveDateFlexible] = useState(false)
  const [moveDateFlexibleReason, setMoveDateFlexibleReason] = useState('')
  const [moveType, setMoveType] = useState<CRMLead['moveType']>('residential')
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
  const [inventory, setInventory] = useState<InventoryItem[]>([])
  const [inventoryLoading, setInventoryLoading] = useState(false)
  const [analysisBusy, setAnalysisBusy] = useState(false)
  const [activePhotoIndex, setActivePhotoIndex] = useState(0)
  const [activityType, setActivityType] = useState<FollowUpLog['type']>('call')
  const [activityNotes, setActivityNotes] = useState('')
  const [newRoomName, setNewRoomName] = useState('')
  const [presetSearch, setPresetSearch] = useState('')
  const [saving, setSaving] = useState(false)
  const [creatingQuote, setCreatingQuote] = useState(false)
  const [loggingActivity, setLoggingActivity] = useState(false)
  const [consultationActive, setConsultationActive] = useState(false)
  const [consultationSaving, setConsultationSaving] = useState(false)
  const [consultationNotes, setConsultationNotes] = useState('')
  const [consultationSummary, setConsultationSummary] = useState('')
  const [consultationSeconds, setConsultationSeconds] = useState(0)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [contextFlag, setContextFlag] = useState<string>('')
  const [assignedRep, setAssignedRep] = useState<string>('')
  const [estimateDate, setEstimateDate] = useState<string>('')
  const [estimateTime, setEstimateTime] = useState<string>('')
  // Lost reason modal
  const [showLostModal, setShowLostModal] = useState(false)
  const [lostReason, setLostReason] = useState<string>('')
  const [lostNotes, setLostNotes] = useState<string>('')
  const [pendingStage, setPendingStage] = useState<CRMLead['stage'] | null>(null)
  // Confirm job modal
  const [showConfirmJobModal, setShowConfirmJobModal] = useState(false)
  const [confirmJobDeposit, setConfirmJobDeposit] = useState<string>('')
  const [confirmJobDepositMethod, setConfirmJobDepositMethod] = useState<string>('E-Transfer')
  const [confirmJobBusy, setConfirmJobBusy] = useState(false)
  // Deposit
  const [depositAmount, setDepositAmount] = useState<string>('')
  const [depositMethod, setDepositMethod] = useState<string>('')
  const [depositLinkBusy, setDepositLinkBusy] = useState(false)
  const [logDepositOpen, setLogDepositOpen] = useState(false)
  const [logDepositMethod, setLogDepositMethod] = useState<'cash' | 'etransfer' | 'cheque'>('etransfer')
  const [logDepositNote, setLogDepositNote] = useState('')
  const [logDepositBusy, setLogDepositBusy] = useState(false)
  const [chargeBalanceBusy, setChargeBalanceBusy] = useState(false)
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
  const [quoteLineItems, setQuoteLineItems] = useState<QuoteLineItem[]>([])
  const [jobFactors, setJobFactors] = useState<JobFactors>({})
  const [customerNotes, setCustomerNotes] = useState('')
  const [recalculateBusy, setRecalculateBusy] = useState(false)
  const pricingMetaRef = useRef<{ crewSize: number; estimatedHours: number; truckCount: number }>({ crewSize: 3, estimatedHours: 3, truckCount: 1 })
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
  const [emailMessages, setEmailMessages] = useState<Array<{ id: string; from_address: string; to_address: string; subject: string | null; body_preview: string | null; direction: 'inbound' | 'outbound'; created_at: string }>>([])
  const [listingLookupBusy, setListingLookupBusy] = useState(false)
  const [scanProgress, setScanProgress] = useState<{ batch: number; totalBatches: number; status: string } | null>(null)
  const [activeTab, setActiveTab] = useState<'timeline' | 'inventory'>('timeline')
  const [error, setError] = useState<string | null>(null)
  const [undoItem, setUndoItem] = useState<{ item: InventoryItem; index: number; timer: number } | null>(null)
  const autosaveTimerRef = useRef<number | null>(null)
  const lastSavedLeadStateRef = useRef('')
  const consultationRecorderRef = useRef<MediaRecorder | null>(null)
  const consultationStreamRef = useRef<MediaStream | null>(null)
  const consultationChunksRef = useRef<Blob[]>([])

  function buildSavedLeadSignature(nextLead: CRMLead) {
    return buildLeadSignature({
      name: nextLead.name || '',
      phone: nextLead.phone || '',
      email: nextLead.email || '',
      moveDate: nextLead.moveDate || '',
      moveType: nextLead.moveType || 'residential',
      source: nextLead.source || '',
      originAddress: nextLead.originAddress || '',
      originCity: nextLead.originCity || '',
      originAccess: nextLead.originAccess || '',
      destAddress: nextLead.destAddress || '',
      destCity: nextLead.destCity || '',
      destAccess: nextLead.destAccess || '',
      parkingNotes: nextLead.parkingNotes || '',
      moveReason: nextLead.moveReason || '',
      notes: nextLead.notes || '',
      stage: nextLead.stage || 'new',
      followUpDate: nextLead.followUpDate || '',
      inventory: nextLead.inventory || [],
    })
  }

  function applyLeadSnapshot(nextLead: CRMLead, options?: { hydrateForm?: boolean }) {
    setLead(nextLead)
    lastSavedLeadStateRef.current = buildSavedLeadSignature(nextLead)

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
    setInventory(nextLead.inventory || [])
    if (nextLead.jobFactors) setJobFactors(nextLead.jobFactors)
    setContextFlag(nextLead.contextFlag || '')
    setAssignedRep(nextLead.assignedRep || '')
    setEstimateDate(nextLead.estimateDate || '')
    setEstimateTime(nextLead.estimateTime || '')
    setLostReason(nextLead.lostReason || '')
    setLostNotes(nextLead.lostNotes || '')
    setDepositAmount(nextLead.depositAmount ? String(nextLead.depositAmount) : '')
    setDepositMethod(nextLead.depositMethod || '')
  }

  function mergeFollowUpLog(entry: FollowUpLog) {
    setFollowUps(current =>
      [...current.filter(item => item.id !== entry.id), entry].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    )
  }

  async function refresh(currentLeadId: string): Promise<{ quoteId?: string } | null> {
    try {
      const nextLead = await fetchSalesLead(currentLeadId)
      const quotePayload = nextLead?.quoteId ? await fetchSalesQuote(nextLead.quoteId) : null
      setQuote(quotePayload?.quote || null)
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
        // Fetch inbound emails from Zoho (stored in email_messages table) for this lead's email
        if (nextLead.email) {
          fetch(`/api/sales/email-messages?email=${encodeURIComponent(nextLead.email)}`)
            .then(r => r.ok ? r.json() : [])
            .then((msgs: typeof emailMessages) => setEmailMessages(msgs))
            .catch(() => {})
        }
      }
      setError(nextLead ? null : 'Lead not found')
      return nextLead ? { quoteId: nextLead.quoteId } : null
    } catch (err) {
      setError((err as Error).message)
      return null
    }
  }

  useEffect(() => {
    if (!params?.id) return
    setLead(null)
    setQuote(null)
    setFollowUps([])
    setError(null)
    void refresh(params.id).then(async (data) => {
      if (searchParams?.get('estimate') === '1') {
        if (data?.quoteId) {
          setQuoteModalOpen(true)
        } else {
          // No quote yet — create one so Save Draft / Preview & Send are enabled
          await createQuote()
        }
      }
    })
  }, [params])

  useEffect(() => {
    if (!lead?.supabaseListing?.address) return
    if ((lead.inventory || []).length > 0) return

    const leadId = lead.id
    const listingAddress = lead.supabaseListing.address

    let cancelled = false

    async function hydrateInventoryFromListing() {
      try {
        setInventoryLoading(true)
        const result = await enrichSalesAddress(listingAddress, false)
        if (cancelled || !result.scan) return

        const nextInventory = result.scan.inventory || []
        const nextMetrics = deriveInventoryMetrics(nextInventory)
        setInventory(nextInventory)

        const saved = await updateSalesLead(leadId, {
          inventory: nextMetrics.inventory,
          totalItems: nextMetrics.totalItems,
          totalCubicFeet: nextMetrics.totalCubicFeet,
          totalWeightLbs: nextMetrics.totalWeightLbs,
          roomBreakdown: buildRoomBreakdown(nextMetrics.inventory),
        })

        if (!cancelled) {
          setLead(saved)
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
      const hasEnrichment = !!(item.recordingUrl || item.transcript || item.aiSummary)
      const isVm = item.isVoicemail || (item.transcript || '').startsWith('[Voicemail]')
      const text =
        item.type === 'call' && isVm
          ? `Went to voicemail${item.duration ? ` — ${item.duration}` : ''}.${item.transcript ? ' Recording transcribed.' : item.recordingUrl ? ' Recording processing…' : ''}`
          : item.type === 'call' && isInboundCall && hasEnrichment
            ? `Inbound call completed${item.duration ? ` — ${item.duration}` : ''}.`
            : item.type === 'consultation' && item.recordingUrl && !item.transcript && !item.aiSummary
              ? 'In-house consultation recorded. Click to retry transcription.'
              : item.notes || item.type

      return {
        id: item.id,
        kind: item.type,
        text,
        date: item.date,
        actor: item.source === 'consultation' ? 'rep' : item.type === 'call' ? 'rep' : 'system',
        recordingUrl: item.recordingUrl,
        transcript: item.transcript,
        aiSummary: item.aiSummary,
        duration: item.duration,
        phone: item.phone,
        isVoicemail: isVm || undefined,
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
        text: m.subject || '(no subject)',
        date: m.created_at,
        actor: 'customer' as const,
        _preview: m.body_preview || '',
        _inbound: true,
      }))

    return [...systemEvents, ...logs, ...fu, ...inboundEmails].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
  }, [followUps, lead, quote, emailMessages])
  const latestCallInsight = useMemo(() => {
    const callLogs = lead?.callLogs || []
    return callLogs.find(item => item.aiSummary || item.transcript || item.recordingUrl) || null
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
    if (lead.stage !== 'booked' && lead.stage !== 'lost') {
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

  useEffect(() => {
    if (!consultationActive) return
    const timer = window.setInterval(() => {
      setConsultationSeconds(current => current + 1)
    }, 1000)
    return () => window.clearInterval(timer)
  }, [consultationActive])

  const inventoryMetrics = useMemo(() => deriveInventoryMetrics(inventory), [inventory])
  const quoteModalTotals = useMemo(() => {
    const depositRate = quote && quote.total > 0 ? quote.deposit / quote.total : 0.2
    return computeQuoteTotals(quoteLineItems, depositRate, Number(quote?.discountAmount || 0))
  }, [quote, quoteLineItems])
  const hasGeneratedInventory = inventoryMetrics.inventory.length > 0
  const hasListingPhotos = listingPhotos.length > 0
  const roomOptions = useMemo(() => {
    const rooms = new Set(DEFAULT_ROOM_OPTIONS)
    inventory.forEach(item => rooms.add(normalizeRoomName(item.room)))
    return Array.from(rooms)
  }, [inventory])
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

  function buildLeadDraftPayload() {
    return {
      name: leadName,
      phone: leadPhone || undefined,
      email: leadEmail || undefined,
      moveDate: moveDate || undefined,
      moveDateFlexible: moveDateFlexible || undefined,
      moveDateFlexibleReason: moveDateFlexibleReason || undefined,
      moveType: moveType || undefined,
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
      moveReason,
      notes,
      inventory: inventoryMetrics.inventory,
      totalItems: inventoryMetrics.totalItems,
      totalCubicFeet: inventoryMetrics.totalCubicFeet,
      totalWeightLbs: inventoryMetrics.totalWeightLbs,
      roomBreakdown: buildRoomBreakdown(inventoryMetrics.inventory),
      jobFactors: Object.keys(jobFactors).length > 0 ? jobFactors : undefined,
      contextFlag: contextFlag || undefined,
      assignedRep: assignedRep || undefined,
      estimateDate: estimateDate || undefined,
      estimateTime: estimateTime || undefined,
      lostReason: lostReason || undefined,
      lostNotes: lostNotes || undefined,
      depositAmount: depositAmount ? Number(depositAmount) : undefined,
      depositMethod: depositMethod || undefined,
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

  // Re-derive line items whenever inventory changes while the modal is open
  // This fixes stale subtotals that were saved before the inventory scan ran
  useEffect(() => {
    if (!quoteModalOpen || !lead) return
    recalculateEstimate()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inventoryMetrics.totalCubicFeet, inventoryMetrics.totalWeightLbs, quoteModalOpen])

  useEffect(() => {
    if (!lead) return
    const autosaveSignature = buildLeadSignature({
      name: leadName,
      phone: leadPhone,
      email: leadEmail,
      moveDate,
      moveType,
      source: leadSource,
      originAddress,
      originCity,
      originAccess,
      destAddress,
      destCity,
      destAccess,
      parkingNotes,
      moveReason,
      notes,
      stage,
      followUpDate,
      inventory,
    })

    if (autosaveSignature === lastSavedLeadStateRef.current) {
      return
    }

    if (autosaveTimerRef.current) {
      window.clearTimeout(autosaveTimerRef.current)
    }

    autosaveTimerRef.current = window.setTimeout(() => {
      void (async () => {
        try {
          const saved = await updateSalesLead(lead.id, buildLeadDraftPayload())
          applyLeadSnapshot(saved)
          setError(null)
        } catch (err) {
          setError((err as Error).message)
        }
      })()
    }, 700)

    return () => {
      if (autosaveTimerRef.current) {
        window.clearTimeout(autosaveTimerRef.current)
      }
    }
  }, [lead, leadName, leadPhone, leadEmail, moveDate, moveType, leadSource, originAddress, originCity, originAccess, destAddress, destCity, destAccess, parkingNotes, moveReason, notes, stage, followUpDate, inventory, contextFlag, estimateDate, estimateTime, assignedRep])

  async function saveLead(options?: { skipLostCheck?: boolean; pendingStageName?: CRMLead['stage'] }) {
    if (!lead) return

    // Intercept: moving to 'lost' requires a reason first
    const targetStage = options?.pendingStageName ?? stage
    if (targetStage === 'lost' && lead.stage !== 'lost' && !options?.skipLostCheck) {
      setPendingStage(targetStage)
      setShowLostModal(true)
      return
    }

    const prevStage = lead.stage
    const stageChanged = targetStage !== prevStage

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
        const updatedLead = await fetchSalesLead(lead.id).catch(() => null)
        if (updatedLead) setFollowUps(updatedLead.callLogs as unknown as FollowUpLog[] ?? [])
        void refresh(lead.id)
      }

      setError(null)
    } catch (err) {
      setError((err as Error).message)
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

  async function handleConfirmJob() {
    if (!lead) return
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

  async function createQuote() {
    if (!lead) return
    try {
      setCreatingQuote(true)
      const result = await createLeadQuote(lead.id)
      setQuote(result.quote)
      setLead(result.lead)
      setQuoteLineItems(result.quote.lineItems || [])
      setQuoteModalDirty(false)
      setQuoteModalOpen(true)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setCreatingQuote(false)
    }
  }

  async function openQuoteBuilder() {
    if (!lead) return
    if (!quote) {
      await createQuote()
      return
    }
    setQuoteLineItems(quote.lineItems || [])
    setCustomerNotes(quote.customerNotes || '')
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

  async function saveQuoteDraft() {
    if (!quote) return
    try {
      setQuoteModalBusy(true)
      const depositRate = quote.total > 0 ? quote.deposit / quote.total : 0.2
      const totals = computeQuoteTotals(quoteLineItems, depositRate, Number(quote.discountAmount || 0))
      const result = await updateSalesQuote(quote.id, {
        lineItems: totals.lineItems,
        subtotal: totals.subtotal,
        hst: totals.hst,
        total: totals.total,
        deposit: totals.deposit,
        balance: totals.balance,
        crewSize: pricingMetaRef.current.crewSize,
        estimatedHours: pricingMetaRef.current.estimatedHours,
        truckCount: pricingMetaRef.current.truckCount,
        customerNotes: customerNotes || undefined,
      })
      setQuote(result.quote)
      if (result.lead) setLead(result.lead)
      setQuoteLineItems(result.quote.lineItems || [])
      setQuoteModalDirty(false)
      // Persist job factors to lead alongside the quote save
      if (lead && Object.keys(jobFactors).length > 0) {
        void updateSalesLead(lead.id, { jobFactors }).catch(() => {})
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setQuoteModalBusy(false)
    }
  }

  async function saveAndPreviewQuote() {
    if (!quote) return
    await saveQuoteDraft()
    router.push(`/sales/quotes/${quote.id}?send=1`)
  }

  async function sendDepositLink() {
    if (!quote || !lead) return
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

  async function chargeBalance() {
    if (!lead || !quote) return
    if (!window.confirm(`Charge the remaining balance of ${formatMoney(quote.balance)} to the card on file?`)) return
    try {
      setChargeBalanceBusy(true)
      const r = await fetch('/api/sales/stripe/charge-balance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ leadId: lead.id, quoteId: quote.id }),
      })
      const payload = await r.json() as { ok?: boolean; error?: string }
      if (!r.ok || !payload.ok) throw new Error(payload.error || 'Charge failed')
      const updatedLead = await updateSalesLead(lead.id, { paymentStatus: 'paid_in_full' })
      setLead(updatedLead)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setChargeBalanceBusy(false)
    }
  }

  async function saveOutcome() {
    if (!lead) return
    setOutcomeBusy(true)
    try {
      await fetch(`/api/sales/leads/${lead.id}/outcome`, {
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
    setReviewSentBusy(true)
    try {
      await fetch('/api/sales/review-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          leadName: lead.name,
          leadEmail: lead.email,
          leadPhone: lead.phone,
          quoteNumber: quote?.number,
          channel: 'both',
        }),
      })
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
    try {
      setListingLookupBusy(true)
      setInventory([])
      setScanProgress({ batch: 0, totalBatches: 0, status: 'Starting photo scan…' })
      setActiveTab('inventory')

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
            }

            if (event.type === 'start') {
              setScanProgress({ batch: 0, totalBatches: event.totalBatches ?? 0, status: `Starting scan of ${event.totalPhotos ?? 0} photos…` })
            } else if (event.type === 'progress') {
              setScanProgress({ batch: (event.batch ?? 1) - 1, totalBatches: event.totalBatches ?? 0, status: event.status ?? '' })
            } else if (event.type === 'batch') {
              allItems = [...allItems, ...(event.items ?? [])]
              setInventory([...allItems])
              setScanProgress({
                batch: event.batch ?? 0,
                totalBatches: event.totalBatches ?? 0,
                status: `Batch ${event.batch}/${event.totalBatches} done — ${allItems.length} items found…`,
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
    window.dispatchEvent(new CustomEvent('crm:open-dialer', { detail: { phone: lead.phone, leadId: lead.id } }))
  }

  function openComposer(channel: 'sms' | 'email') {
    if (!lead) return
    const firstName = (lead.name || 'there').split(' ')[0]
    setComposerChannel(channel)
    setComposerSubject(channel === 'email' ? 'Following up — Saturn Star Moving' : '')
    // Set a brief placeholder while AI drafts — user can start typing immediately
    setComposerBody(
      channel === 'sms'
        ? `Hi ${firstName}, this is Saturn Star Moving — just following up on your move. What date are you working with?`
        : `Hi ${firstName},\n\nJust following up on your move with Saturn Star Moving. Let me know if you have any questions or want to lock in a date.\n\nJohn\nSaturn Star Moving`
    )
    setComposerOpen(true)
    // Immediately kick off AI — it will replace the placeholder if it returns in time
    void runSmartCompose(channel, lead)
  }

  async function sendComposerMessage() {
    if (!lead) return
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

  async function runSmartCompose(channel: 'sms' | 'email', currentLead: typeof lead) {
    if (!currentLead) return
    try {
      setScBusy(true)
      const smsHistory = followUps.filter(f => f.type === 'sms').map(f => ({ direction: 'outbound', body: f.notes || '', created_at: f.date }))
      const emailHistory = followUps.filter(f => f.type === 'email').map(f => ({ direction: 'outbound', subject: f.notes || '', body_preview: '', created_at: f.date }))
      const res = await fetch('https://saturn-lead-intake.johnowolabi80.workers.dev/smart-compose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lead: currentLead, smsHistory, emailHistory, channel }),
      })
      const data = await res.json() as { ok: boolean; draft?: string; subject?: string; error?: string }
      if (data.ok && data.draft) {
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
    setInventory(current =>
      current.map((item, itemIndex) =>
        itemIndex === index
          ? {
              ...item,
              included: item.included === false ? true : false,
              exclusionReason: item.included === false ? '' : item.exclusionReason || 'Excluded from move scope',
            }
          : item
      )
    )
  }

  function addInventoryItem(room = 'Unassigned') {
    setInventory(current => [...current, { id: `inv-${Date.now()}`, room, name: '', qty: 1, cubicFeet: 0, weightLbs: 0, included: true }])
  }

  function removeInventoryItem(index: number) {
    const removed = inventory[index]
    if (!removed) return
    setInventory(current => current.filter((_, i) => i !== index))
    // Clear previous undo timer
    setUndoItem(prev => {
      if (prev) clearTimeout(prev.timer)
      const timer = window.setTimeout(() => setUndoItem(null), 6000)
      return { item: removed, index, timer }
    })
  }

  function undoRemoveInventoryItem() {
    if (!undoItem) return
    clearTimeout(undoItem.timer)
    setInventory(current => {
      const next = [...current]
      next.splice(undoItem.index, 0, undoItem.item)
      return next
    })
    setUndoItem(null)
  }

  function addRoomSection() {
    const room = normalizeRoomName(newRoomName)
    addInventoryItem(room)
    setNewRoomName('')
  }

  function addPresetItem(presetId: string) {
    const preset = INVENTORY_PRESETS.find(item => item.id === presetId)
    if (!preset) return
    setInventory(current => [...current, createInventoryItemFromPreset(preset)])
    setPresetSearch('')
  }

  async function logActivity() {
    if (!lead || !activityNotes.trim()) return
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

      <div className="overflow-hidden rounded-[8px] border border-[var(--app-line)] bg-[var(--app-panel)]">
        {/* Lead header bar */}
        <div className="flex flex-wrap items-center gap-3 border-b border-[var(--app-line)] bg-white px-5 py-3">
          <h1 className="font-display text-base font-semibold text-[var(--app-ink)]">{lead.name}</h1>
          <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em] ${
            lead.stage === 'booked' ? 'bg-emerald-100 text-emerald-700' :
            lead.stage === 'lost' ? 'bg-rose-100 text-rose-600' :
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
          {lead.assignedRep ? (
            <span className="ml-auto text-xs text-[var(--app-muted)]">Rep: {lead.assignedRep}</span>
          ) : null}
          {lead.stage === 'estimate_scheduled' && lead.estimateDate ? (
            <span className="rounded-full bg-violet-50 px-2.5 py-0.5 text-[10px] font-semibold text-violet-700">
              Estimate: {formatDate(lead.estimateDate)}{lead.estimateTime ? ` @ ${lead.estimateTime}` : ''}
            </span>
          ) : null}
        </div>
        <div className="grid min-h-[760px] lg:grid-cols-[minmax(0,1fr)_300px] xl:grid-cols-[250px_minmax(0,1fr)_280px]">
          <LeadBasicsPanel
            lead={lead}
            leadName={leadName}
            leadPhone={leadPhone}
            leadEmail={leadEmail}
            leadSource={leadSource}
            moveDate={moveDate}
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
            onOriginAddressChange={setOriginAddress}
            onOriginCityChange={setOriginCity}
            onOriginAccessChange={setOriginAccess}
            onDestAddressChange={setDestAddress}
            onDestCityChange={setDestCity}
            onDestAccessChange={setDestAccess}
            onParkingNotesChange={setParkingNotes}
            listingLookupBusy={listingLookupBusy}
            hasListing={!!lead.supabaseListing}
            onScanListing={() => {
              if (lead.supabaseListing) {
                void streamScanForLead(lead.id)
              } else {
                void lookupListingForLead()
              }
            }}
          />

          <aside className="order-2 border-t border-[var(--app-line)] bg-[var(--app-panel)] lg:order-3 lg:border-l lg:border-t-0 xl:order-3">
            {/* Confirm Job CTA — prominent when lead has a quote and isn't booked yet */}
            {quote && lead.stage !== 'booked' && lead.stage !== 'lost' ? (
              <div className="border-b border-[var(--app-line)] bg-[#f0faf5] p-5">
                <div className="crm-label text-[var(--app-accent)]">Ready to close?</div>
                <button
                  onClick={() => setShowConfirmJobModal(true)}
                  className="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-[10px] bg-[var(--app-accent)] text-sm font-semibold text-white transition hover:bg-[#0a5b47]"
                >
                  Confirm Job + Send Booking
                </button>
              </div>
            ) : lead.stage === 'booked' ? (
              <div className="border-b border-[var(--app-line)] bg-[#f0faf5] p-5 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                    Job Confirmed
                  </span>
                </div>
                {/* Post-job review request */}
                {(lead.email || lead.phone) && (
                  <button
                    onClick={() => void sendReviewRequest()}
                    disabled={reviewSentBusy || reviewSent}
                    className="w-full rounded-[8px] bg-[#f5a623] px-3 py-2 text-xs font-semibold text-[#1a2744] hover:opacity-90 disabled:opacity-60"
                  >
                    {reviewSent ? '⭐ Review Request Sent!' : reviewSentBusy ? 'Sending...' : '⭐ Send Review Request'}
                  </button>
                )}
                <button
                  onClick={() => setOutcomeOpen(o => !o)}
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
                          <button key={star} type="button" onClick={() => setOutcomeRating(star)} className={`text-xl transition ${outcomeRating >= star ? 'text-amber-400' : 'text-stone-300'}`}>★</button>
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
                    <textarea value={outcomeNotes} onChange={e => setOutcomeNotes(e.target.value)} className="crm-input w-full resize-none text-xs" rows={2} placeholder="Any notes about the job..." />
                    <button onClick={() => void saveOutcome()} disabled={outcomeBusy} className="w-full rounded-[8px] bg-[#1a2744] px-3 py-2 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-60">
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
                      <button
                        onClick={() => void chargeBalance()}
                        disabled={chargeBalanceBusy}
                        className="w-full rounded-[8px] bg-[var(--app-accent)] px-3 py-2 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-60"
                      >
                        {chargeBalanceBusy ? 'Charging...' : `Charge Balance — ${formatMoney(quote.balance)}`}
                      </button>
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
                          className="w-full rounded-[8px] bg-[#f5a623] px-3 py-2 text-xs font-bold text-[#1a2744] hover:opacity-90"
                        >
                          💳 Collect Card &amp; Charge Now
                        </button>
                        <button
                          onClick={() => void sendDepositLink()}
                          disabled={depositLinkBusy}
                          className="w-full rounded-[8px] bg-[#1a2744] px-3 py-2 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-60"
                        >
                          {depositLinkBusy ? 'Sending...' : '🔗 Send Self-Pay Link (SMS)'}
                        </button>
                      </>
                    )}
                    <button
                      onClick={() => setLogDepositOpen(open => !open)}
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
                          disabled={logDepositBusy}
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
              {lead.phone ? <button onClick={openDialer} className="crm-button-dark w-full justify-center">Call Lead</button> : null}
              <div className="grid grid-cols-2 gap-3">
                {lead.phone ? <button onClick={() => openComposer('sms')} className="crm-button justify-center">Send SMS</button> : <div />}
                {lead.email ? <button onClick={() => openComposer('email')} className="crm-button justify-center">Email</button> : <div />}
              </div>
              <button
                onClick={() => void startConsultation()}
                disabled={consultationActive || consultationSaving}
                className="crm-button w-full justify-center"
              >
                {consultationActive ? `Recording Consultation • ${formatSeconds(consultationSeconds)}` : consultationSaving ? 'Saving Consultation...' : 'Record Consultation'}
              </button>
              {quote ? (
                <button onClick={() => void openQuoteBuilder()} className="crm-button w-full justify-center border-[rgba(34,72,56,0.2)] bg-[rgba(34,72,56,0.08)] text-[var(--app-accent)]">
                  Build Estimate
                </button>
              ) : (
                <button onClick={() => void openQuoteBuilder()} disabled={creatingQuote} className="crm-button w-full justify-center border-[rgba(34,72,56,0.2)] bg-[rgba(34,72,56,0.08)] text-[var(--app-accent)] disabled:opacity-60">
                  {creatingQuote ? 'Building...' : 'Build Estimate'}
                </button>
              )}
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
                        {lead.phone ? <button onClick={() => openComposer('sms')} className="rounded-[6px] bg-white px-3 py-1.5 text-xs font-medium text-[var(--app-ink)] shadow-sm ring-1 ring-inset ring-[var(--app-line)] hover:bg-[var(--app-bg)]">Send SMS</button> : null}
                        {lead.email ? <button onClick={() => openComposer('email')} className="rounded-[6px] bg-white px-3 py-1.5 text-xs font-medium text-[var(--app-ink)] shadow-sm ring-1 ring-inset ring-[var(--app-line)] hover:bg-[var(--app-bg)]">Email</button> : null}
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <div className="rounded-[8px] border border-[var(--app-line)] bg-[var(--app-bg)] px-3 py-3">
                    <div className="text-sm font-medium text-[var(--app-ink)]">
                      {lead.followUpNote || (quote ? 'Follow up on the open estimate.' : 'No active task yet')}
                    </div>
                    <div className="mt-2 text-xs leading-5 text-[var(--app-muted)]">
                      {lead.followUpDate ? `Follow up on ${formatDate(lead.followUpDate)}.` : 'Steps will appear here once you have a call, consultation, or quote.'}
                    </div>
                  </div>
                )}
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
                <input value={assignedRep} onChange={e => setAssignedRep(e.target.value)} className="crm-input mt-2" placeholder="Rep name or initials" />
              </label>

              {/* Deposit section — visible when booked */}
              {lead.stage === 'booked' && (
                <div>
                  <span className="crm-label">Deposit</span>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <input
                      type="number"
                      value={depositAmount}
                      onChange={e => setDepositAmount(e.target.value)}
                      className="crm-input"
                      placeholder="Amount $"
                    />
                    <select value={depositMethod} onChange={e => setDepositMethod(e.target.value)} className="crm-input">
                      <option value="">Method</option>
                      {DEPOSIT_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </div>
                </div>
              )}

              <button onClick={() => void saveLead()} disabled={saving} className="crm-button w-full justify-center disabled:opacity-60">
                {saving ? 'Saving...' : 'Save Lead'}
              </button>
              <button onClick={() => void removeLead()} disabled={deleteBusy} className="crm-button w-full justify-center border-rose-200 text-rose-700 hover:bg-rose-50 disabled:opacity-60">
                {deleteBusy ? 'Deleting...' : 'Delete Lead'}
              </button>
              <button
                onClick={() => setIncidentOpen(true)}
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
              <button
                onClick={() => setActiveTab('inventory')}
                className={`-mb-px flex items-center gap-2 border-b-2 px-3 pb-3 pt-1 text-sm font-medium transition ${activeTab === 'inventory' ? 'border-[var(--app-accent)] text-[var(--app-accent)]' : 'border-transparent text-[var(--app-muted)] hover:text-[var(--app-ink)]'}`}
              >
                Inventory
                {inventoryMetrics.totalCubicFeet > 0 && (
                  <span className="rounded-full bg-[rgba(34,72,56,0.1)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--app-accent)]">
                    {inventoryMetrics.totalCubicFeet} cu ft
                  </span>
                )}
              </button>
            </div>
            {activeTab === 'timeline' && (
            <LeadTimeline
              lead={lead}
              quote={quote}
              timeline={timeline}
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
            {activeTab === 'inventory' && (
              <div className="flex-1 overflow-y-auto">
                {/* Scan progress banner */}
                {scanProgress && (
                  <div className="border-b border-[var(--app-line)] bg-[var(--app-bg)] px-5 py-3">
                    <div className="mb-2 flex items-center justify-between text-xs font-medium text-[var(--app-ink)]">
                      <span>📷 {scanProgress.status}</span>
                      {scanProgress.totalBatches > 0 && (
                        <span className="text-[var(--app-muted)]">{scanProgress.batch}/{scanProgress.totalBatches} batches</span>
                      )}
                    </div>
                    {scanProgress.totalBatches > 0 && (
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--app-line)]">
                        <div
                          className="h-full rounded-full bg-[var(--app-accent)] transition-all duration-500"
                          style={{ width: `${Math.round((scanProgress.batch / scanProgress.totalBatches) * 100)}%` }}
                        />
                      </div>
                    )}
                  </div>
                )}

                {/* Items populating in real-time */}
                {inventory.length === 0 && !scanProgress ? (
                  <div className="p-5 text-sm text-[var(--app-muted)]">
                    No inventory yet. Use the Scan button on the left after entering the origin address, or add items manually from the panel below.
                  </div>
                ) : (
                  <div className="divide-y divide-[var(--app-line)]">
                    {inventory.map((item, idx) => (
                      <div key={idx} className="flex items-start justify-between gap-3 px-5 py-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--app-muted)]">{item.room}</span>
                            {!item.included && <span className="rounded-full bg-stone-100 px-1.5 py-0.5 text-[10px] text-stone-500">excluded</span>}
                          </div>
                          <div className="mt-0.5 text-sm font-medium text-[var(--app-ink)]">
                            {(item.qty ?? 1) > 1 ? `${item.qty}× ` : ''}{item.name}{item.size ? ` · ${item.size}` : ''}
                          </div>
                          {item.notes && <div className="mt-0.5 text-xs text-[var(--app-muted)]">{item.notes}</div>}
                        </div>
                        <div className="shrink-0 text-right">
                          <div className="text-sm font-semibold text-[var(--app-ink)]">{item.cubicFeet} cu ft</div>
                          <div className="text-xs text-[var(--app-muted)]">{item.weightLbs} lbs</div>
                        </div>
                      </div>
                    ))}
                    {scanProgress && (
                      <div className="flex items-center gap-2 px-5 py-3 text-xs text-[var(--app-muted)]">
                        <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-[var(--app-accent)]" />
                        Scanning next batch…
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
        <div className="space-y-6">
          <div className="crm-panel">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="crm-label">Inventory + Scope</div>
                <div className="mt-2 text-xl font-semibold text-stone-900">Build the inventory before you price.</div>
                <p className="mt-2 crm-helper">AI can give you a fast draft. Reps still decide what is actually included in the move.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {lead.supabaseListing && (
                  <button
                    onClick={() => void refresh(lead.id)}
                    disabled={inventoryLoading}
                    className="crm-button disabled:opacity-60"
                  >
                    {inventoryLoading ? 'Loading scan...' : 'Reload scan'}
                  </button>
                )}
                {lead.supabaseListing?.carouselphotos && lead.supabaseListing.carouselphotos.length > 0 && inventoryMetrics.inventory.length === 0 && (
                  <button
                    onClick={() => void generateInventoryFromPhotos(true)}
                    disabled={analysisBusy}
                    className="crm-button disabled:opacity-60"
                  >
                    {analysisBusy ? 'Analyzing photos...' : 'Generate from MLS photos'}
                  </button>
                )}
                {lead.supabaseListing?.carouselphotos && lead.supabaseListing.carouselphotos.length > 0 && inventoryMetrics.inventory.length > 0 && (
                  <button
                    onClick={() => void generateInventoryFromPhotos(true)}
                    disabled={analysisBusy}
                    className="crm-button disabled:opacity-60"
                  >
                    {analysisBusy ? 'Re-scanning photos...' : 'Re-scan all MLS photos'}
                  </button>
                )}
                <button onClick={() => addInventoryItem()} className="crm-button">Add item</button>
                <input
                  value={newRoomName}
                  onChange={event => setNewRoomName(event.target.value)}
                  className="crm-input min-w-40"
                  placeholder="Add room"
                />
                <button onClick={addRoomSection} className="crm-button">Create room</button>
              </div>
            </div>
            {lead.supabaseListing && (
              <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-4 text-sm text-emerald-800">
                <div>Direct mail match: {lead.supabaseListing.address}</div>
                {lead.supabaseListing.furniture_scan_date && inventoryMetrics.inventory.length > 0 && (
                  <div className="mt-1 text-xs text-emerald-700">Saved inventory scan loaded into this lead.</div>
                )}
                {lead.supabaseListing.furniture_scan_date && !inventoryLoading && inventoryMetrics.inventory.length === 0 && (
                  <div className="mt-1 text-xs text-amber-700">
                    Listing metadata says a scan exists, but there is no saved inventory record for this property in `listing_inventory_scans`.
                  </div>
                )}
              </div>
            )}
            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              <div className="crm-kpi">
                <div className="crm-label">Inventory Lines</div>
                <div className="crm-value">{inventoryMetrics.inventory.length}</div>
              </div>
              <div className="crm-kpi">
                <div className="crm-label">Estimated Items</div>
                <div className="crm-value">{inventoryMetrics.totalItems}</div>
              </div>
                <div className="crm-kpi">
                  <div className="crm-label">Estimated Cubic Feet</div>
                  <div className="crm-value">{inventoryMetrics.totalCubicFeet}</div>
                </div>
                <div className="crm-kpi">
                  <div className="crm-label">Estimated Weight</div>
                  <div className="crm-value">{inventoryMetrics.totalWeightLbs}</div>
                </div>
            </div>
            <div className="mt-5 space-y-3">
              <div className="crm-subsection">
                <div className="crm-label">Preset Library</div>
                <div className="mt-2 text-sm text-stone-700">Use this to add anything the scan missed without rebuilding the whole scope manually.</div>
                <div className="mt-3 flex flex-col gap-3">
                  <input
                    value={presetSearch}
                    onChange={event => setPresetSearch(event.target.value)}
                    className="crm-input"
                    placeholder="Search common items like sofa, dresser, freezer, treadmill..."
                  />
                  <div className="grid gap-2 md:grid-cols-2">
                    {presetMatches.map(preset => (
                      <button key={preset.id} onClick={() => addPresetItem(preset.id)} className="flex items-center justify-between rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3 text-left transition hover:border-stone-900 hover:bg-white">
                        <span>
                          <span className="block text-sm text-stone-800">{preset.label}</span>
                          <span className="block text-xs text-stone-500">{preset.item.cubicFeet || 0} cu ft</span>
                        </span>
                        <span className="text-xs text-stone-500">{preset.item.weightLbs || 0} lbs</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              {inventoryLoading ? (
                <div className="rounded-2xl border border-dashed border-stone-200 px-4 py-6 text-sm text-stone-500">
                  Loading saved inventory scan from the matched listing...
                </div>
              ) : inventory.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-stone-200 px-4 py-6 text-sm text-stone-500">
                  No inventory entered yet. Add items manually or pull them from the MLS scan before building the quote.
                </div>
              ) : (
                groupedInventory.map(([roomName, roomItems]) => (
                  <InventoryRoomSection
                    key={roomName}
                    roomName={roomName}
                    roomItems={roomItems}
                    roomOptions={roomOptions}
                    onAddToRoom={addInventoryItem}
                    onUpdateItem={updateInventoryItem}
                    onToggleItem={toggleInventoryItem}
                    onRemoveItem={removeInventoryItem}
                  />
                ))
              )}
            </div>

            {/* Undo toast */}
            {undoItem && (
              <div className="mt-3 flex items-center justify-between rounded-xl bg-stone-800 px-4 py-2.5 text-sm text-white">
                <span className="text-stone-300">Removed <span className="font-medium text-white">{undoItem.item.name || undoItem.item.item}</span></span>
                <button onClick={undoRemoveInventoryItem} className="ml-4 font-semibold text-amber-400 hover:text-amber-300 transition-colors">
                  Undo
                </button>
              </div>
            )}
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <label>
                <span className="crm-label">Move Reason</span>
                <textarea value={moveReason} onChange={event => setMoveReason(event.target.value)} className="crm-input mt-2 min-h-24" />
              </label>
              <label>
                <span className="crm-label">Internal Notes</span>
                <textarea value={notes} onChange={event => setNotes(event.target.value)} className="crm-input mt-2 min-h-24" />
              </label>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="crm-kpi">
              <div className="crm-label">Items</div>
              <div className="crm-value">{inventoryMetrics.totalItems}</div>
            </div>
            <div className="crm-kpi">
              <div className="crm-label">Cubic Feet</div>
              <div className="crm-value">{inventoryMetrics.totalCubicFeet}</div>
            </div>
            <div className="crm-kpi">
              <div className="crm-label">Weight</div>
              <div className="crm-value">{inventoryMetrics.totalWeightLbs}</div>
            </div>
            <div className="crm-kpi">
              <div className="crm-label">Current Quote</div>
              <div className="crm-value text-lg">{quote ? formatMoney(quote.total) : '—'}</div>
            </div>
          </div>
        </div>

        <div className="space-y-6">
          {listingPhotos.length > 0 && (
            <div className="crm-panel">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="crm-label">MLS Photos</div>
                  <div className="mt-2 text-sm text-stone-700">
                    {listingPhotos.length} photos linked to this listing.
                    {analysisBusy ? ' Reviewing all images now.' : ' Keep this visible while reviewing the AI draft.'}
                  </div>
                </div>
                {analysisBusy && (
                  <div className="rounded-full bg-stone-900 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.16em] text-white">
                    Scanning
                  </div>
                )}
              </div>
              {analysisBusy && (
                <div className="mt-3">
                  <div className="flex items-center justify-between text-[11px] font-medium uppercase tracking-[0.14em] text-stone-500">
                    <span>Scan Progress</span>
                    <span>{Math.min(activePhotoIndex + 1, listingPhotos.length)} / {listingPhotos.length} photos</span>
                  </div>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-stone-200">
                    <div
                      className="h-full rounded-full bg-[var(--app-accent)] transition-all duration-500"
                      style={{ width: `${(Math.min(activePhotoIndex + 1, listingPhotos.length) / Math.max(listingPhotos.length, 1)) * 100}%` }}
                    />
                  </div>
                </div>
              )}
              <div className="mt-4 overflow-hidden rounded-3xl border border-stone-200 bg-stone-100">
                <img
                  src={listingPhotos[activePhotoIndex]}
                  alt="MLS listing reference"
                  className={`h-72 w-full object-cover transition duration-500 ${analysisBusy ? 'scale-[1.02] opacity-95' : 'opacity-100'}`}
                />
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <span className="crm-chip">{analysisBusy ? 'AI reviewing full set' : 'Photo source locked'}</span>
                <span className="crm-chip">{listingPhotos.length} photos</span>
                <span className="crm-chip">{hasGeneratedInventory ? 'Draft on lead' : 'No saved draft yet'}</span>
                {analysisBusy ? <span className="crm-chip">{Math.min(activePhotoIndex + 1, listingPhotos.length)} scanned</span> : null}
              </div>
              <div className="mt-4 grid grid-cols-4 gap-2">
                {listingPhotos.map((photo, index) => (
                  <button
                    key={`${photo}-${index}`}
                    type="button"
                    onClick={() => setActivePhotoIndex(index)}
                    className={`overflow-hidden rounded-2xl border ${activePhotoIndex === index ? 'border-stone-900' : 'border-stone-200'}`}
                  >
                    <img src={photo} alt={`MLS thumbnail ${index + 1}`} className="h-20 w-full object-cover" />
                  </button>
                ))}
              </div>
              <div className="mt-3 text-xs leading-5 text-stone-500">
                {analysisBusy
                  ? 'The inventory will save back to the listing cache after this scan finishes.'
                  : 'Use Re-scan all MLS photos whenever you want to refresh the cached inventory draft from the full photo set.'}
              </div>
            </div>
          )}

          <div className="crm-panel">
            <div className="crm-label">Next Action</div>
            <div className="mt-3 text-sm leading-6 text-stone-700">
              {quote
                ? `Quote ${quote.number} is ${quote.status}. ${lead.followUpDate ? `Follow up on ${formatDate(lead.followUpDate)}.` : 'Set a follow-up date.'}`
                : inventoryMetrics.totalCubicFeet > 0
                  ? 'Inventory is on file. Build the quote next, then review price overrides before sharing.'
                  : 'Finish the intake, add inventory, and then build the first quote.'}
            </div>
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
                  className="crm-input"
                  placeholder="Email subject"
                />
              ) : null}
              <textarea
                value={composerBody}
                onChange={event => setComposerBody(event.target.value)}
                className={`crm-input min-h-56 transition-opacity ${scBusy ? 'opacity-50' : 'opacity-100'}`}
                placeholder={composerChannel === 'sms' ? 'Type your SMS...' : 'Type your email...'}
              />
            </div>
            <div className="flex flex-col-reverse gap-3 border-t border-[var(--app-line)] px-4 py-4 md:flex-row md:items-center md:justify-between md:px-5">
              <button
                onClick={() => void runSmartCompose(composerChannel, lead)}
                disabled={scBusy}
                className="text-sm text-[var(--app-muted)] hover:text-[var(--app-accent)] disabled:opacity-40 transition-colors"
              >
                {scBusy ? '✨ AI drafting...' : '✨ Regenerate'}
              </button>
              <div className="flex flex-col-reverse gap-3 md:flex-row md:items-center">
                <button onClick={() => setComposerOpen(false)} className="crm-button w-full md:w-auto">Cancel</button>
                <button onClick={() => void sendComposerMessage()} disabled={composerBusy || !composerBody.trim()} className="crm-button-dark disabled:opacity-60">
                  {composerBusy ? 'Sending...' : composerChannel === 'sms' ? 'Send SMS' : 'Send Email'}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* ── Lost Reason Modal ────────────────────────────────────── */}
      {showLostModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-[16px] border border-[var(--app-line)] bg-white p-6 shadow-2xl">
            <h2 className="font-display text-lg font-semibold text-[var(--app-ink)]">Why was this lead lost?</h2>
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
                <button onClick={() => setShowConfirmJobModal(false)} className="ml-4 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-slate-400 hover:bg-white/10 hover:text-white transition-colors">✕</button>
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
              <button onClick={() => setShowConfirmJobModal(false)} className="flex-1 rounded-xl border border-slate-200 bg-white py-2.5 text-sm font-medium text-slate-500 hover:bg-slate-50 transition-colors">Cancel</button>
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

      <EstimateDraftModal
        open={quoteModalOpen}
        quote={quote}
        lead={lead}
        originAddress={originAddress}
        originCity={originCity}
        destCity={destCity}
        destAddress={destAddress}
        listingLookupBusy={listingLookupBusy}
        analysisBusy={analysisBusy}
        recalculateBusy={recalculateBusy}
        listingPhotos={listingPhotos}
        activePhotoIndex={activePhotoIndex}
        inventoryMetrics={inventoryMetrics}
        groupedInventory={groupedInventory}
        presetMatches={presetMatches}
        quoteLineItems={quoteLineItems}
        quoteModalTotals={quoteModalTotals}
        quoteModalBusy={quoteModalBusy}
        jobFactors={jobFactors}
        onClose={() => void closeQuoteModal()}
        onOriginAddressChange={setOriginAddress}
        onOriginCityChange={setOriginCity}
        onDestCityChange={setDestCity}
        onDestAddressChange={setDestAddress}
        onLookupListing={() => void lookupListingForLead()}
        onRefreshInventory={() => void generateInventoryFromPhotos(true)}
        onRecalculate={handleModalRecalculate}
        onAddLineItem={addQuoteLineItem}
        onSetActivePhotoIndex={setActivePhotoIndex}
        onAddPreset={addPresetItem}
        onUpdateLineItem={updateQuoteLineItem}
        onRemoveLineItem={removeQuoteLineItem}
        onSetLineItems={setQuoteLineItems}
        onSaveDraft={() => void saveQuoteDraft()}
        onSaveAndPreview={() => void saveAndPreviewQuote()}
        onJobFactorsChange={setJobFactors}
        onAddInventoryItems={items => setInventory(current => [...current, ...items])}
        onUpdateInventoryItem={updateInventoryItem}
        onToggleInventoryItem={toggleInventoryItem}
        onRemoveInventoryItem={removeInventoryItem}
        customerNotes={customerNotes}
        onCustomerNotesChange={setCustomerNotes}
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
