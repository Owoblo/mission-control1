'use client'

import Link from 'next/link'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { EstimateDraftModal } from '@/app/components/sales/lead-detail/estimate-draft-modal'
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
import { SALES_LEAD_STAGES, computeQuoteTotals, deriveInventoryMetrics, formatDate, formatDateTime, formatMoney } from '@/lib/sales'
import { createLeadQuote, deleteSalesLead, enrichSalesAddress, fetchSalesLead, fetchSalesOverview, fetchSalesQuote, saveLeadConsultation, saveSalesFollowUp, sendSalesMessage, updateSalesLead, updateSalesQuote } from '@/lib/sales-api'
import type { CRMLead, CRMQuote, FollowUpLog, InventoryItem, QuoteLineItem } from '@/lib/types'

export default function SalesLeadDetailPage() {
  const params = useParams() as { id?: string }
  const router = useRouter()
  const [lead, setLead] = useState<CRMLead | null>(null)
  const [quote, setQuote] = useState<CRMQuote | null>(null)
  const [followUps, setFollowUps] = useState<FollowUpLog[]>([])
  const [stage, setStage] = useState<CRMLead['stage']>('new')
  const [followUpDate, setFollowUpDate] = useState('')
  const [leadName, setLeadName] = useState('')
  const [leadPhone, setLeadPhone] = useState('')
  const [leadEmail, setLeadEmail] = useState('')
  const [moveDate, setMoveDate] = useState('')
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
  const [quoteModalOpen, setQuoteModalOpen] = useState(false)
  const [quoteModalBusy, setQuoteModalBusy] = useState(false)
  const [quoteModalDirty, setQuoteModalDirty] = useState(false)
  const [quoteLineItems, setQuoteLineItems] = useState<QuoteLineItem[]>([])
  const [composerOpen, setComposerOpen] = useState(false)
  const [composerChannel, setComposerChannel] = useState<'sms' | 'email'>('sms')
  const [composerSubject, setComposerSubject] = useState('Following up — Saturn Star Moving')
  const [composerBody, setComposerBody] = useState('')
  const [composerBusy, setComposerBusy] = useState(false)
  const [listingLookupBusy, setListingLookupBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
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
  }

  function mergeFollowUpLog(entry: FollowUpLog) {
    setFollowUps(current =>
      [...current.filter(item => item.id !== entry.id), entry].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    )
  }

  async function refresh(currentLeadId: string) {
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
      }
      setError(nextLead ? null : 'Lead not found')
    } catch (err) {
      setError((err as Error).message)
    }
  }

  useEffect(() => {
    if (!params?.id) return
    setLead(null)
    setQuote(null)
    setFollowUps([])
    setError(null)
    void refresh(params.id)
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
      const text =
        item.type === 'call' && isInboundCall && hasEnrichment
          ? `Inbound call completed${item.duration ? ` — ${item.duration}` : ''}.`
          : item.type === 'consultation' && item.recordingUrl && !item.transcript && !item.aiSummary
            ? 'In-house consultation recorded. Transcript and AI summary are processing.'
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
      }
    })

    const fu = followUps.map(item => ({
      id: item.id,
      kind: item.type,
      text: item.notes || 'Follow-up logged',
      date: item.date,
      actor: 'rep',
    }))

    return [...systemEvents, ...logs, ...fu].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
  }, [followUps, lead, quote])
  const latestCallInsight = useMemo(() => {
    const callLogs = lead?.callLogs || []
    return callLogs.find(item => item.aiSummary || item.transcript || item.recordingUrl) || null
  }, [lead?.callLogs])
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
    }
  }

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
  }, [lead, leadName, leadPhone, leadEmail, moveDate, moveType, leadSource, originAddress, originCity, originAccess, destAddress, destCity, destAccess, parkingNotes, moveReason, notes, stage, followUpDate, inventory])

  async function saveLead() {
    if (!lead) return
    try {
      setSaving(true)
      const saved = await updateSalesLead(lead.id, buildLeadDraftPayload())
      applyLeadSnapshot(saved, { hydrateForm: true })
      setError(null)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
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
      })
      setQuote(result.quote)
      if (result.lead) setLead(result.lead)
      setQuoteLineItems(result.quote.lineItems || [])
      setQuoteModalDirty(false)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setQuoteModalBusy(false)
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
      const result = await enrichSalesAddress(originAddress.trim(), false)
      if (!result.listing) {
        throw new Error('No listing match found for this address yet.')
      }

      const updates: Partial<CRMLead> = {
        originAddress: originAddress.trim(),
        originCity: originCity || result.listing.city || undefined,
        supabaseListing: result.listing,
      }

      if (result.scan) {
        updates.inventory = result.scan.inventory || []
        updates.totalItems = result.scan.totalItems || 0
        updates.totalCubicFeet = result.scan.totalCubicFeet || 0
        updates.totalWeightLbs = result.scan.totalWeightLbs || 0
        updates.roomBreakdown = buildRoomBreakdown(result.scan.inventory || [])
        setInventory(result.scan.inventory || [])
      }

      const saved = await updateSalesLead(lead.id, updates)
      setLead(saved)
      if (saved.originCity) setOriginCity(saved.originCity)
      setError(null)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setListingLookupBusy(false)
    }
  }

  function openDialer() {
    if (!lead?.phone || typeof window === 'undefined') return
    window.dispatchEvent(new CustomEvent('crm:open-dialer', { detail: { phone: lead.phone, name: lead.name } }))
  }

  function openComposer(channel: 'sms' | 'email') {
    if (!lead) return
    const firstName = (lead.name || 'there').split(' ')[0]
    setComposerChannel(channel)
    setComposerSubject(channel === 'email' ? 'Following up — Saturn Star Moving' : '')
    setComposerBody(
      channel === 'sms'
        ? `Hi ${firstName}, this is Saturn Star Moving. I’m following up on your move request. What date and locations are you planning for?`
        : `Hi ${firstName},

I’m following up on your move request with Saturn Star Moving.

Let me know your move date, origin, destination, and any inventory or access details you already know, and I’ll keep your estimate moving.

Saturn Star Moving`
    )
    setComposerOpen(true)
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
    setInventory(current => current.filter((_, itemIndex) => itemIndex !== index))
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
            resolve(new Blob(consultationChunksRef.current, { type: recorder.mimeType || 'audio/webm' }))
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
        <div className="grid min-h-[760px] lg:grid-cols-[minmax(0,1fr)_300px] xl:grid-cols-[250px_minmax(0,1fr)_280px]">
          <LeadBasicsPanel
            lead={lead}
            leadName={leadName}
            leadPhone={leadPhone}
            leadEmail={leadEmail}
            leadSource={leadSource}
            moveDate={moveDate}
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
            onMoveTypeChange={setMoveType}
            onOriginAddressChange={setOriginAddress}
            onOriginCityChange={setOriginCity}
            onOriginAccessChange={setOriginAccess}
            onDestAddressChange={setDestAddress}
            onDestCityChange={setDestCity}
            onDestAccessChange={setDestAccess}
            onParkingNotesChange={setParkingNotes}
          />

          <aside className="order-2 border-t border-[var(--app-line)] bg-[var(--app-panel)] lg:order-3 lg:border-l lg:border-t-0 xl:order-3">
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
              <div className="mt-5 space-y-4 text-sm">
                <div className="rounded-[8px] border border-[var(--app-line)] bg-[var(--app-bg)] px-3 py-3">
                  <div className="text-sm font-medium text-[var(--app-ink)]">
                    {latestCallInsight?.aiSummary?.nextAction || lead.followUpNote || (quote ? 'Follow up on the open estimate.' : 'No active task yet')}
                  </div>
                  <div className="mt-2 text-xs leading-5 text-[var(--app-muted)]">
                    {latestCallInsight?.aiSummary?.followUpReason ||
                      (lead.followUpDate ? `Follow up on ${formatDate(lead.followUpDate)}.` : 'The next step will appear here once a call, consultation, or quote creates one.')}
                  </div>
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
              <label className="block">
                <span className="crm-label">Stage</span>
                <select value={stage} onChange={event => setStage(event.target.value as CRMLead['stage'])} className="crm-input mt-2">
                  {SALES_LEAD_STAGES.map(item => (
                    <option key={item.id} value={item.id}>{item.label}</option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="crm-label">Follow-Up Date</span>
                <input type="date" value={followUpDate} onChange={event => setFollowUpDate(event.target.value)} className="crm-input mt-2" />
              </label>
              <button onClick={() => void saveLead()} disabled={saving} className="crm-button w-full justify-center disabled:opacity-60">
                {saving ? 'Saving...' : 'Save Lead'}
              </button>
              <button onClick={() => void removeLead()} disabled={deleteBusy} className="crm-button w-full justify-center border-rose-200 text-rose-700 hover:bg-rose-50 disabled:opacity-60">
                {deleteBusy ? 'Deleting...' : 'Delete Lead'}
              </button>
            </div>
          </aside>

          <div className="order-3 lg:order-2 xl:order-2">
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
            />
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
                className="crm-input min-h-56"
                placeholder={composerChannel === 'sms' ? 'Type your SMS...' : 'Type your email...'}
              />
            </div>
            <div className="flex flex-col-reverse gap-3 border-t border-[var(--app-line)] px-4 py-4 md:flex-row md:items-center md:justify-end md:px-5">
              <button onClick={() => setComposerOpen(false)} className="crm-button w-full md:w-auto">Cancel</button>
              <button onClick={() => void sendComposerMessage()} disabled={composerBusy || !composerBody.trim()} className="crm-button-dark disabled:opacity-60">
                {composerBusy ? 'Sending...' : composerChannel === 'sms' ? 'Send SMS' : 'Send Email'}
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
        listingLookupBusy={listingLookupBusy}
        analysisBusy={analysisBusy}
        listingPhotos={listingPhotos}
        activePhotoIndex={activePhotoIndex}
        inventoryMetrics={inventoryMetrics}
        groupedInventory={groupedInventory}
        presetMatches={presetMatches}
        quoteLineItems={quoteLineItems}
        quoteModalTotals={quoteModalTotals}
        quoteModalBusy={quoteModalBusy}
        onClose={() => void closeQuoteModal()}
        onOriginAddressChange={setOriginAddress}
        onOriginCityChange={setOriginCity}
        onDestCityChange={setDestCity}
        onLookupListing={() => void lookupListingForLead()}
        onRefreshInventory={() => void generateInventoryFromPhotos(true)}
        onAddLineItem={addQuoteLineItem}
        onSetActivePhotoIndex={setActivePhotoIndex}
        onAddPreset={addPresetItem}
        onUpdateLineItem={updateQuoteLineItem}
        onRemoveLineItem={removeQuoteLineItem}
        onSaveDraft={() => void saveQuoteDraft()}
      />
    </div>
  )
}
