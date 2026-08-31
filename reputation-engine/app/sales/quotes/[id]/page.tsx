'use client'

import Link from 'next/link'
import { useEffect, useMemo, useRef, useState } from 'react'
import { buildMoveSpecificNotes } from '@/lib/move-scope'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { PACKING_MATERIAL_PRESETS } from '@/lib/packing-materials'
import { useCurrentUser } from '@/lib/hooks/use-current-user'
import { QUOTE_STATUSES, UHAUL_RATE_PER_KM, computeQuoteTotals, dateStamp, estimateLeadQuote, formatDate, formatMoney, getCrewRate, getDefaultDepositRate, getDefaultPaymentTerms, getLeadAssignedRepName, hasLockedEstimateLineItem, isInvoiceStylePaymentTerms, paymentTermsLabel, reconcileEstimatedQuoteLineItems, validUntil } from '@/lib/sales'
import { enqueueQuoteSendJobs, fetchQuoteSendJobs, fetchSalesQuote, saveSalesFollowUp, updateSalesLead, updateSalesQuote } from '@/lib/sales-api'
import { buildManualQuoteSmsDraft } from '@/lib/sales-quote-sms'
import { compactCustomerLink } from '@/lib/customer-links'
import { getReceiptBrand } from '@/lib/receipt-brand'
import { quoteCommercialSnapshotChanged } from '@/lib/quote-pricing-safety'
import type { QuoteSendJob } from '@/lib/quote-send-jobs'
import type { CRMClient, CRMLead, CRMQuote, FollowUpLog, QuoteLineItem } from '@/lib/types'

function plusDays(days: number) {
  const date = new Date()
  date.setDate(date.getDate() + days)
  return date.toISOString().slice(0, 10)
}

function buildQuoteEmailHtml({
  brandName,
  customerName,
  moveDate,
  originCity,
  destCity,
  total,
  deposit,
  acceptUrl,
  validUntilText,
  moveDescription,
  scopeNotes,
  isRevision,
}: {
  brandName: string
  customerName: string
  moveDate?: string
  originCity?: string
  destCity?: string
  total: number
  deposit: number
  acceptUrl: string
  validUntilText: string
  moveDescription?: string
  scopeNotes?: string[]
  isRevision?: boolean
}) {
  const heading = isRevision ? 'Your quote has been updated.' : 'Your quote is ready.'
  const intro = isRevision
    ? `Hi ${customerName}, we updated your moving estimate and kept everything on the same quote link for easy review.`
    : `Hi ${customerName}, we prepared your moving estimate and linked everything below for quick review.`
  const summary = isRevision
    ? 'Open the same quote link to review the latest date, pricing, and job details, then accept or decline it when ready.'
    : 'Review the full quote online, accept or decline it, and print or save a PDF from the quote page if you need a document copy.'
  const footer = isRevision
    ? 'This pricing reflects the latest inventory and access details currently on file. Reply to this email if you want any further adjustments before booking.'
    : 'This pricing is based on the inventory and access details currently on file. Reply to this email if you want any adjustments before booking.'
  return `
  <div style="background:#f7f4ee;padding:32px 16px;font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#171717;">
    <div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #e9e4d9;border-radius:18px;overflow:hidden;">
      <div style="padding:28px 32px;border-bottom:1px solid #eee7da;">
        <div style="font-size:12px;letter-spacing:.18em;text-transform:uppercase;color:#7c766a;font-weight:700;">${brandName}</div>
        <h1 style="margin:14px 0 8px;font-size:30px;line-height:1.1;color:#171717;">${heading}</h1>
        <p style="margin:0;font-size:15px;line-height:1.7;color:#4b5563;">${intro}</p>
      </div>
      <div style="padding:28px 32px;">
        <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;margin-bottom:24px;">
          <div style="padding:16px;border:1px solid #eee7da;border-radius:14px;background:#fcfbf8;">
            <div style="font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:#8a8478;font-weight:700;">Your Move</div>
            <div style="margin-top:8px;font-size:18px;font-weight:700;color:#171717;">Moving estimate</div>
            <div style="margin-top:4px;font-size:14px;color:#57534e;">${originCity || 'Origin TBD'} to ${destCity || 'Destination TBD'}</div>
          </div>
          <div style="padding:16px;border:1px solid #eee7da;border-radius:14px;background:#fcfbf8;">
            <div style="font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:#8a8478;font-weight:700;">Move Date</div>
            <div style="margin-top:8px;font-size:18px;font-weight:700;color:#171717;">${moveDate || 'To be confirmed'}</div>
            <div style="margin-top:4px;font-size:14px;color:#57534e;">Valid until ${validUntilText}</div>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;margin-bottom:28px;">
          <div style="padding:18px;border-radius:14px;background:#0f6a53;color:#ffffff;">
            <div style="font-size:11px;letter-spacing:.16em;text-transform:uppercase;opacity:.74;font-weight:700;">Estimated (excl. HST)</div>
            <div style="margin-top:8px;font-size:30px;font-weight:700;">${formatMoney(total)}</div>
            <div style="margin-top:4px;font-size:11px;opacity:.65;">+ 13% HST — full breakdown on quote</div>
          </div>
          <div style="padding:18px;border-radius:14px;background:#f4efe4;border:1px solid #eee7da;">
            <div style="font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:#8a8478;font-weight:700;">Deposit To Book</div>
            <div style="margin-top:8px;font-size:30px;font-weight:700;color:#171717;">${formatMoney(deposit)}</div>
          </div>
        </div>
        ${moveDescription ? `<div style="margin-bottom:18px;padding:14px 18px;border-radius:12px;background:#f4efe4;border:1px solid #eee7da;font-size:14px;line-height:1.7;color:#374151;">${moveDescription}</div>` : ''}
        ${scopeNotes && scopeNotes.length > 0 ? `<div style="margin-bottom:18px;padding:14px 18px;border-radius:12px;background:#fcfbf8;border:1px solid #eee7da;"><div style="font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:#8a8478;font-weight:700;margin-bottom:8px;">Move-specific notes</div>${scopeNotes.map(note => `<div style="font-size:13px;line-height:1.7;color:#4b5563;">• ${note}</div>`).join('')}</div>` : ''}
        <div style="margin-bottom:18px;font-size:15px;line-height:1.7;color:#374151;">${summary}</div>
        <div style="margin-bottom:28px;">
          <a href="${acceptUrl}" style="display:inline-block;padding:14px 22px;border-radius:999px;background:#0f6a53;color:#ffffff;text-decoration:none;font-weight:700;">Open Quote</a>
        </div>
        <div style="padding-top:18px;border-top:1px solid #eee7da;font-size:13px;line-height:1.8;color:#6b7280;">
          ${footer}
        </div>
      </div>
    </div>
  </div>`
}

export default function SalesQuoteDetailPage() {
  const params = useParams() as { id?: string }
  const router = useRouter()
  const currentUser = useCurrentUser()
  const [quote, setQuote] = useState<CRMQuote | null>(null)
  const [lead, setLead] = useState<CRMLead | null>(null)
  const [client, setClient] = useState<CRMClient | null>(null)
  const [followUps, setFollowUps] = useState<FollowUpLog[]>([])
  const [status, setStatus] = useState<CRMQuote['status']>('draft')
  const [followUpDate, setFollowUpDate] = useState(plusDays(3))
  const [sendChannel, setSendChannel] = useState<'email' | 'sms'>('email')
  const [lineItems, setLineItems] = useState<QuoteLineItem[]>([])
  const [validDays, setValidDays] = useState(30)
  const [depositRate, setDepositRate] = useState(30)
  const [paymentTerms, setPaymentTerms] = useState<CRMQuote['paymentTerms']>('deposit_required')
  const [discountAmount, setDiscountAmount] = useState(0)
  const [discountLabel, setDiscountLabel] = useState('Courtesy discount')
  const [crewSize, setCrewSize] = useState(3)
  const [estimatedHours, setEstimatedHours] = useState(3)
  const [truckCount, setTruckCount] = useState(1)
  const [estimatedWeightLbs, setEstimatedWeightLbs] = useState(0)
  const [longDistanceDistanceKm, setLongDistanceDistanceKm] = useState(0)
  const [longDistanceTruckCost, setLongDistanceTruckCost] = useState(0)
  const [longDistanceGasCost, setLongDistanceGasCost] = useState(0)
  const [longDistanceInsuranceCost, setLongDistanceInsuranceCost] = useState(0)
  const [longDistanceMiscCost, setLongDistanceMiscCost] = useState(150)
  const [longDistanceMarkupRate, setLongDistanceMarkupRate] = useState(40)
  const [routeSummary, setRouteSummary] = useState('')
  const [emailSubject, setEmailSubject] = useState('')
  const [emailBody, setEmailBody] = useState('')
  const [smsBody, setSmsBody] = useState('')
  const [saveBusy, setSaveBusy] = useState(false)
  const [logBusy, setLogBusy] = useState(false)
  const [sendBusy, setSendBusy] = useState(false)
  const [sendBothBusy, setSendBothBusy] = useState(false)
  const [justSent, setJustSent] = useState(false)
  const [sendBothResult, setSendBothResult] = useState<{ email?: boolean; sms?: boolean } | null>(null)
  const [showPreview, setShowPreview] = useState<'both' | 'email' | null>(null)
  const [previewTab, setPreviewTab] = useState<'email' | 'sms' | 'quote'>('email')
  const [routeBusy, setRouteBusy] = useState(false)
  const [packingQuantities, setPackingQuantities] = useState<Record<string, number>>({})
  const [copied, setCopied] = useState<'accept' | 'email' | 'sms' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [moreMenuOpen, setMoreMenuOpen] = useState(false)
  const [deliveryJobs, setDeliveryJobs] = useState<QuoteSendJob[]>([])
  const searchParams = useSearchParams()
  const deliveryStartingRef = useRef(false)

  function mergeFollowUpLog(entry: FollowUpLog) {
    setFollowUps(current =>
      [...current.filter(item => item.id !== entry.id), entry].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    )
  }

  async function refresh(currentQuoteId: string) {
    try {
      const data = await fetchSalesQuote(currentQuoteId)
      if (!data) {
        setQuote(null)
        setError('Quote not found')
        return
      }

      setQuote(data.quote)
      setLead(data.lead)
      setClient(data.client)
      setFollowUps(data.followUps)
      setStatus(data.quote.status)
      setLineItems(data.quote.lineItems)
      setValidDays(data.quote.validDays || 30)
      const nextPaymentTerms = data.quote.paymentTerms || getDefaultPaymentTerms(data.lead?.moveType || data.quote.moveType)
      setPaymentTerms(nextPaymentTerms)
      setDepositRate(data.quote.total > 0 ? Math.round((data.quote.deposit / data.quote.total) * 100) : getDefaultDepositRate(data.lead?.moveType || data.quote.moveType) * 100)
      setDiscountAmount(Number(data.quote.discountAmount || 0))
      setDiscountLabel(data.quote.discountLabel || 'Courtesy discount')
      // Start with saved values
      const savedCrew = Number(data.quote.crewSize || 3)
      const savedHours = Number(data.quote.estimatedHours || 3)
      const savedTrucks = Number(data.quote.truckCount || 1)
      // Sync up against current inventory — only bump up, never downgrade a rep's intentional choice
      if (data.lead) {
        const fresh = estimateLeadQuote(data.lead, { legs: data.quote.legs || undefined }, data.lead.jobFactors)
        const freshCrew = (fresh.crewSize || 3) > savedCrew ? (fresh.crewSize || 3) : savedCrew
        const freshHours = (fresh.estimatedHours || 3) > savedHours ? (fresh.estimatedHours || 3) : savedHours
        const freshTrucks = (fresh.truckCount || 1) > savedTrucks ? (fresh.truckCount || 1) : savedTrucks
        setCrewSize(freshCrew)
        setEstimatedHours(freshHours)
        setTruckCount(freshTrucks)
        // If metadata was stale, silently update DB so customer preview iframe shows correct values
        if (freshCrew !== savedCrew || freshTrucks !== savedTrucks || freshHours !== savedHours) {
          updateSalesQuote(data.quote.id, {
            crewSize: freshCrew,
            estimatedHours: freshHours,
            truckCount: freshTrucks,
          }).catch(() => {})
        }
      } else {
        setCrewSize(savedCrew)
        setEstimatedHours(savedHours)
        setTruckCount(savedTrucks)
      }
      setEstimatedWeightLbs(Number(data.quote.estimatedWeightLbs || data.lead?.totalWeightLbs || 0))
      setLongDistanceDistanceKm(Number(data.quote.longDistanceDistanceKm || 0))
      setLongDistanceTruckCost(Number(data.quote.longDistanceTruckCost || 0))
      setLongDistanceGasCost(Number(data.quote.longDistanceGasCost || 0))
      setLongDistanceInsuranceCost(Number(data.quote.longDistanceInsuranceCost || 0))
      setLongDistanceMiscCost(Number(data.quote.longDistanceMiscCost || 0))
      setLongDistanceMarkupRate(Number(data.quote.longDistanceMarkupRate || 40))
      setFollowUpDate(data.lead?.followUpDate || plusDays(3))
      setError(null)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  useEffect(() => {
    if (!params?.id) return
    void refresh(params.id)
  }, [params])

  useEffect(() => {
    if (!quote?.id) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null

    async function refreshDeliveries() {
      const jobs = await fetchQuoteSendJobs(quote!.id).catch(() => [])
      if (cancelled) return
      setDeliveryJobs(jobs)
      if (jobs.some(job => job.status === 'pending' || job.status === 'running')) {
        timer = setTimeout(refreshDeliveries, 5000)
      }
    }

    void refreshDeliveries()
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [quote?.id])

  // Auto-open preview when navigated from "Preview & Send" on estimate modal
  // Strip ?send=1 from URL immediately after opening so it doesn't re-trigger
  // on quote refresh and trap the rep on this page
  useEffect(() => {
    if (searchParams?.get('send') === '1' && quote) {
      setShowPreview('both')
      setPreviewTab('email')
      router.replace(`/sales/quotes/${quote.id}`, { scroll: false })
    }
  }, [searchParams, quote?.id])

  useEffect(() => {
    const moveType = lead?.moveType || quote?.moveType
    if (!moveType || !quote) return
    const currentRate = quote.total > 0 ? Math.round((quote.deposit / quote.total) * 100) / 100 : null
    const expectedRate = getDefaultDepositRate(moveType)
    if (currentRate === null || Math.abs(currentRate - expectedRate) < 0.005) {
      setDepositRate(expectedRate * 100)
    }
  }, [lead?.moveType, quote?.deposit, quote?.moveType, quote?.total])

  const acceptUrl = useMemo(() => {
    if (!quote?.id || !quote.acceptToken || typeof window === 'undefined') return ''
    return compactCustomerLink(`${window.location.origin}/quote-accept?id=${encodeURIComponent(quote.id)}&token=${encodeURIComponent(quote.acceptToken)}`)
  }, [quote])

  function closePreviewModal() {
    setShowPreview(null)
    setPreviewTab('email')
  }

  useEffect(() => {
    if (!showPreview) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') closePreviewModal()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [showPreview])

  const quoteTotals = useMemo(
    () => computeQuoteTotals(lineItems, Math.max(0, Math.min(100, depositRate)) / 100, Math.max(0, discountAmount)),
    [depositRate, discountAmount, lineItems]
  )
  const invoiceStyleTerms = isInvoiceStylePaymentTerms(paymentTerms)

  useEffect(() => {
    if (invoiceStyleTerms && depositRate !== 0) {
      setDepositRate(0)
    } else if (!invoiceStyleTerms && depositRate === 0) {
      setDepositRate(getDefaultDepositRate(lead?.moveType || quote?.moveType) * 100)
    }
  }, [depositRate, invoiceStyleTerms, lead?.moveType, quote?.moveType])
  const rawSubtotal = useMemo(() => lineItems.reduce((sum, item) => sum + Number(item.amount || 0), 0), [lineItems])
  const discountPct = useMemo(() => rawSubtotal > 0 ? discountAmount / rawSubtotal : 0, [discountAmount, rawSubtotal])
  const isRevision = Boolean(quote?.sentAt || quote?.viewedAt || quote?.acceptedAt || quote?.respondedAt)
  const quoteOwnerName = useMemo(() => getLeadAssignedRepName(lead) || 'Unassigned', [lead])
  const isAcceptedQuoteLocked = useMemo(
    () => status === 'accepted' || status === 'invoiced' || !!quote?.acceptedAt || lead?.stage === 'booked',
    [lead?.stage, quote?.acceptedAt, status]
  )
  const canEditQuoteWorkspace = useMemo(() => {
    if (!currentUser) return false
    const hasSalesAccess =
      currentUser.role === 'owner' ||
      currentUser.role === 'manager' ||
      currentUser.role === 'sales_rep'
    return hasSalesAccess && !isAcceptedQuoteLocked
  }, [currentUser, isAcceptedQuoteLocked])
  const quoteReadOnlyReason = useMemo(() => {
    if (isAcceptedQuoteLocked) {
      return 'This quote has already been accepted/booked. Customer-facing pricing and route details are locked on this page.'
    }
    return null
  }, [isAcceptedQuoteLocked])

  const emailDraft = useMemo(() => {
    if (!quote) return { subject: '', body: '', htmlBody: '', href: '#' }
    const brand = getReceiptBrand(lead, quote)
    const firstName = (client?.name || lead?.name || 'there').split(' ')[0]
    const subject = isRevision ? `Your updated moving estimate from ${brand.name}` : `Your moving estimate from ${brand.name}`
    const total = quoteTotals.total || quote.total
    const subtotalForEmail = quoteTotals.subtotal || quote.subtotal
    const deposit = quoteTotals.deposit || quote.deposit
    const introLine = invoiceStyleTerms
      ? (isRevision ? 'We updated your commercial relocation estimate.' : 'Your commercial relocation estimate is ready.')
      : (isRevision ? 'We updated your binding hourly estimate.' : 'Your binding hourly estimate is ready.')
    const actionLine = isRevision ? 'Open your same quote link below to review the latest details:' : 'Review and confirm here:'
    const detailLine = isRevision
      ? 'This updated pricing reflects the latest confirmed inventory and access details currently on file.'
      : 'This pricing is based on the confirmed inventory and access details currently on file.'
    const scopeNotes = buildMoveSpecificNotes(lead?.jobFactors, lead?.inventory, lead?.moveType)
    const body = `Hi ${firstName},

${introLine}

Move Date: ${formatDate(quote.moveDate)}
Total: ${formatMoney(total)}
${invoiceStyleTerms ? `Payment terms: ${paymentTermsLabel(paymentTerms)}` : `Deposit to book: ${formatMoney(deposit)}`}

${actionLine}
${acceptUrl}

This quote is valid until ${validUntil(quote)}.
${detailLine}

Reply to this message if you want anything adjusted.

${brand.fullName}`

    return {
      subject,
      body,
      htmlBody: buildQuoteEmailHtml({
        brandName: brand.fullName,
        customerName: firstName,
        moveDate: formatDate(quote.moveDate),
        originCity: quote.originCity,
        destCity: quote.destCity,
        total: subtotalForEmail,  // show pre-tax as hero; HST shown on quote page
        deposit,
        acceptUrl,
        validUntilText: validUntil(quote),
        moveDescription: quote.moveDescription,
        scopeNotes,
        isRevision,
      }),
      href: `mailto:${client?.email || lead?.email || ''}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`,
    }
  }, [acceptUrl, client?.email, client?.name, invoiceStyleTerms, isRevision, lead?.email, lead?.jobFactors, lead?.name, paymentTerms, quote, quoteTotals])

  const smsDraft = useMemo(() => {
    if (!quote) return ''
    const firstName = (client?.name || lead?.name || 'there').split(' ')[0]
    return buildManualQuoteSmsDraft({
      firstName,
      quoteNumber: quote.number,
      acceptUrl,
      isRevision,
      commercial: invoiceStyleTerms,
      brandName: getReceiptBrand(lead, quote).name,
    })
  }, [acceptUrl, client?.name, invoiceStyleTerms, isRevision, lead?.name, paymentTerms, quote, quoteTotals])

  useEffect(() => {
    setEmailSubject(emailDraft.subject)
    setEmailBody(emailDraft.body)
  }, [emailDraft.body, emailDraft.subject])

  useEffect(() => {
    setSmsBody(smsDraft)
  }, [smsDraft])

  const crewRate = useMemo(() => getCrewRate(crewSize, lead?.moveType || quote?.moveType), [crewSize, lead?.moveType, quote?.moveType])

  useEffect(() => {
    if (!lead || !quote) return
    // Never replace a persisted fixed-price quote. The functional state update
    // below performs the same check against the latest local state so an
    // in-flight/manual override is protected without subscribing this effect to
    // lineItems and creating a render loop.
    if (hasLockedEstimateLineItem(quote.lineItems || [])) return
    const rebuilt = estimateLeadQuote(lead, {
      crewSize,
      estimatedHours,
      truckCount,
      estimatedWeightLbs,
      longDistanceDistanceKm,
      longDistanceTruckCost,
      longDistanceGasCost,
      longDistanceInsuranceCost,
      longDistanceMiscCost,
      longDistanceMarkupRate,
      legs: quote.legs || undefined,
    }, lead.jobFactors)
    setLineItems(current => reconcileEstimatedQuoteLineItems(current, rebuilt.lineItems))
  }, [crewSize, estimatedHours, truckCount, estimatedWeightLbs, longDistanceDistanceKm, longDistanceTruckCost, longDistanceGasCost, longDistanceInsuranceCost, longDistanceMiscCost, longDistanceMarkupRate, lead, quote])

  async function copyText(value: string, kind: 'accept' | 'email' | 'sms') {
    await navigator.clipboard.writeText(value)
    setCopied(kind)
    window.setTimeout(() => setCopied(null), 1400)
  }

  function ensureQuoteEditable() {
    if (canEditQuoteWorkspace) return true
    setError(quoteReadOnlyReason || 'This quote is view-only for you.')
    return false
  }

  function buildQuotePricingUpdates(extra: Partial<CRMQuote> = {}): Partial<CRMQuote> {
    return {
      lineItems: quoteTotals.lineItems,
      subtotal: quoteTotals.subtotal,
      hst: quoteTotals.hst,
      total: quoteTotals.total,
      deposit: quoteTotals.deposit,
      balance: quoteTotals.balance,
      ...(Number(quote?.priceOverrideTotal || 0) > 0
        ? { priceOverrideTotal: quoteTotals.total }
        : {}),
      discountAmount,
      discountLabel,
      crewSize,
      estimatedHours,
      truckCount,
      estimatedWeightLbs,
      longDistanceDistanceKm,
      longDistanceTruckCost,
      longDistanceGasCost,
      longDistanceInsuranceCost,
      longDistanceMiscCost,
      longDistanceMarkupRate,
      paymentTerms,
      validDays,
      ...extra,
    }
  }

  async function persistQuotePricingBeforeDelivery() {
    if (!quote) return null
    if (quoteTotals.total <= 0 || quoteTotals.lineItems.length === 0 || !quoteTotals.lineItems.some(item => Number(item.amount || 0) > 0)) {
      throw new Error('Quote delivery blocked: save a positive price and at least one priced line item before sending.')
    }
    const pricingUpdates = buildQuotePricingUpdates({ status: quote.status })
    // Preview is normally opened immediately after the estimate was saved. Do
    // not put a second, identical PATCH in front of the send request: a slow or
    // rejected no-op save previously made the button flash "Sending…" and then
    // return without ever reaching the outbox.
    if (!quoteCommercialSnapshotChanged(quote, pricingUpdates)) {
      return { quote, lead }
    }
    const result = await updateSalesQuote(quote.id, pricingUpdates)
    if (
      Math.abs(Number(result.quote.total || 0) - quoteTotals.total) > 0.01 ||
      !result.quote.lineItems?.some(item => Number(item.amount || 0) > 0)
    ) {
      throw new Error('Quote delivery blocked because the saved price does not match the preview. Reopen the estimate and save it again.')
    }
    setQuote(result.quote)
    if (result.lead) setLead(result.lead)
    setStatus(result.quote.status)
    return result
  }

  async function saveStatus() {
    if (!quote) return
    if (!ensureQuoteEditable()) return
    try {
      setSaveBusy(true)
      const result = await updateSalesQuote(quote.id, buildQuotePricingUpdates({
        status,
        acceptedAt: status === 'accepted' ? dateStamp() : quote.acceptedAt,
        respondedAt: ['accepted', 'declined'].includes(status) ? new Date().toISOString() : quote.respondedAt,
      }))
      setQuote(result.quote)
      setLead(result.lead)
      setStatus(result.quote.status)
      setError(null)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaveBusy(false)
    }
  }

  async function logDraftAsSent() {
    if (!quote) return
    if (!ensureQuoteEditable()) return
    const sendLabel = isRevision ? 'Updated quote' : 'Quote'
    try {
      setLogBusy(true)
      const sentResult = await updateSalesQuote(quote.id, buildQuotePricingUpdates({
        status: 'sent',
        sentAt: new Date().toISOString(),
      }))

      let nextLead = sentResult.lead
      if (lead) {
        const followUpResult = await saveSalesFollowUp({
          leadId: lead.id,
          quoteId: quote.id,
          type: sendChannel,
          followUpDate,
          notes: `${sendChannel === 'email' ? `${sendLabel} emailed` : `${sendLabel} texted`} with acceptance link.`,
        })
        mergeFollowUpLog(followUpResult.log)
        const updatedLead = await updateSalesLead(lead.id, { followUpDate })
        nextLead = updatedLead
      }

      setQuote(sentResult.quote)
      setLead(nextLead)
      setStatus(sentResult.quote.status)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLogBusy(false)
    }
  }

  async function markAsSentSkipEmail() {
    if (!quote) return
    if (!ensureQuoteEditable()) return
    try {
      setLogBusy(true)
      const result = await updateSalesQuote(quote.id, buildQuotePricingUpdates({
        status: 'sent',
        sentAt: new Date().toISOString(),
      }))
      if (lead) {
        await updateSalesLead(lead.id, { followUpDate })
      }
      setQuote(result.quote)
      setLead(result.lead)
      setStatus(result.quote.status)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLogBusy(false)
    }
  }

  async function acceptOnBehalf() {
    if (!quote) return
    if (!ensureQuoteEditable()) return
    try {
      setSaveBusy(true)
      const result = await updateSalesQuote(quote.id, buildQuotePricingUpdates({
        status: 'accepted',
        sentAt: quote.sentAt || new Date().toISOString(),
        acceptedAt: new Date().toISOString(),
        respondedAt: new Date().toISOString(),
      }))
      if (lead) {
        await updateSalesLead(lead.id, { followUpDate: undefined })
      }
      setQuote(result.quote)
      setLead(result.lead)
      setStatus(result.quote.status)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaveBusy(false)
    }
  }

  async function sendBothNow() {
    if (!quote) return
    if (!ensureQuoteEditable()) return
    const emailTo = client?.email || lead?.email
    const phoneTo = client?.phone || lead?.phone
    const hasEmail = Boolean(emailTo)
    const hasPhone = Boolean(phoneTo)
    const sendLabel = isRevision ? 'Updated quote' : 'Quote'
    if (!hasEmail && !hasPhone) {
      setError('No email or phone on file for this client.')
      return
    }
    if (deliveryStartingRef.current) return
    deliveryStartingRef.current = true

    try {
      setSendBothBusy(true)
      setSendBothResult(null)
      const pricingResult = await persistQuotePricingBeforeDelivery()
      const activeQuote = pricingResult?.quote || quote

      const jobs: Array<{
        channel: 'email' | 'sms'
        recipient: string
        subject?: string
        body: string
        htmlBody?: string
        notes?: string
      }> = []

      if (hasEmail) {
        jobs.push({
          channel: 'email',
          recipient: emailTo!,
          subject: emailSubject,
          body: emailBody,
          htmlBody: emailDraft.htmlBody,
          notes: `${sendLabel} email sent from async outbox.`,
        })
      }

      if (hasPhone) {
        jobs.push({
          channel: 'sms',
          recipient: phoneTo!,
          body: smsBody,
          notes: `${sendLabel} SMS sent from async outbox.`,
        })
      }

      const queued = await enqueueQuoteSendJobs({
        quoteId: activeQuote.id,
        leadId: lead?.id || activeQuote.leadId,
        followUpDate,
        jobs,
      })
      setDeliveryJobs(queued.jobs)
      const incomplete = queued.jobs.filter(job => job.status !== 'sent')
      setSendBothResult(Object.fromEntries(queued.jobs.map(job => [job.channel, job.status === 'sent'])) as { email?: boolean; sms?: boolean })
      if (incomplete.length > 0) {
        setError(`Delivery is queued for retry (${incomplete.map(job => job.channel).join(' + ')}). Do not send it again; this outbox will retry automatically.`)
        return
      }

      const leadId = lead?.id ?? activeQuote.leadId
      setError(null)
      setJustSent(true)
      setShowPreview(null)
      // Keep navigation inside Next.js. A hard location reload destroys the mounted
      // Twilio Voice Device and drops any browser call the rep is handling.
      setTimeout(() => { router.push(leadId ? `/sales/leads/${leadId}` : '/sales') }, 1800)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      deliveryStartingRef.current = false
      setSendBothBusy(false)
    }
  }

  async function sendNow() {
    if (!quote) return
    if (!ensureQuoteEditable()) return
    const to = sendChannel === 'email' ? (client?.email || lead?.email) : (client?.phone || lead?.phone)
    const body = sendChannel === 'email' ? emailBody : smsBody
    const subject = sendChannel === 'email' ? emailSubject : undefined
    const sendLabel = isRevision ? 'Updated quote' : 'Quote'
    if (!to || !body) return
    if (deliveryStartingRef.current) return
    deliveryStartingRef.current = true

    try {
      setSendBusy(true)
      const pricingResult = await persistQuotePricingBeforeDelivery()
      const activeQuote = pricingResult?.quote || quote
      const queued = await enqueueQuoteSendJobs({
        quoteId: activeQuote.id,
        leadId: lead?.id || activeQuote.leadId,
        followUpDate,
        jobs: [{
          channel: sendChannel,
          recipient: to,
          subject,
          body,
          htmlBody: sendChannel === 'email' ? emailDraft.htmlBody : undefined,
          notes: `${sendChannel === 'email' ? `${sendLabel} email sent` : `${sendLabel} SMS sent`} from async outbox.`,
        }],
      })
      setDeliveryJobs(queued.jobs)
      const delivery = queued.jobs[0]
      if (!delivery || delivery.status !== 'sent') {
        setError(`Delivery is queued for retry. Do not send it again; this outbox will retry automatically.`)
        return
      }

      const leadId = lead?.id ?? activeQuote.leadId
      setJustSent(true)
      setShowPreview(null)
      setTimeout(() => { router.push(leadId ? `/sales/leads/${leadId}` : '/sales') }, 1800)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      deliveryStartingRef.current = false
      setSendBusy(false)
    }
  }

  function updateLineItem(index: number, field: keyof QuoteLineItem, value: string) {
    if (!canEditQuoteWorkspace) return
    setLineItems(current =>
      current.map((item, itemIndex) =>
        itemIndex === index
          ? {
              ...item,
              [field]: field === 'amount' ? Number(value || 0) : value,
            }
          : item
      )
    )
  }

  function addLineItem() {
    if (!canEditQuoteWorkspace) return
    setLineItems(current => [...current, { description: '', details: '', amount: 0 }])
  }

  function removeLineItem(index: number) {
    if (!canEditQuoteWorkspace) return
    setLineItems(current => current.filter((_, itemIndex) => itemIndex !== index))
  }

  function addPackingMaterial(presetId: string) {
    if (!canEditQuoteWorkspace) return
    const preset = PACKING_MATERIAL_PRESETS.find(item => item.id === presetId)
    if (!preset) return
    const qty = Number(packingQuantities[preset.id] || 1)
    if (!qty || qty < 1) return
    setLineItems(current => [
      ...current,
      {
        description: preset.label,
        details: `${preset.description} · Qty ${qty}`,
        amount: Number((preset.unitPrice * qty).toFixed(2)),
      },
    ])
    setPackingQuantities(current => ({ ...current, [preset.id]: 1 }))
  }

  function rebuildFromLead() {
    if (!lead) return
    if (!canEditQuoteWorkspace) return
    const rebuilt = estimateLeadQuote(lead, { legs: quote?.legs || undefined }, lead.jobFactors)
    setLineItems(rebuilt.lineItems)
    setCrewSize(rebuilt.crewSize || 3)
    setEstimatedHours(rebuilt.estimatedHours || 3)
    setTruckCount(rebuilt.truckCount || 1)
    setEstimatedWeightLbs(Number(rebuilt.estimatedWeightLbs || lead.totalWeightLbs || 0))
    setLongDistanceDistanceKm(Number(rebuilt.longDistanceDistanceKm || 0))
    setLongDistanceTruckCost(Number(rebuilt.longDistanceTruckCost || 0))
    setLongDistanceGasCost(Number(rebuilt.longDistanceGasCost || 0))
    setLongDistanceInsuranceCost(Number(rebuilt.longDistanceInsuranceCost || 150))
    setLongDistanceMiscCost(Number(rebuilt.longDistanceMiscCost || 150))
    setLongDistanceMarkupRate(Number(rebuilt.longDistanceMarkupRate || 40))
  }

  async function estimateRouteCosts() {
    if (!quote) return
    if (!ensureQuoteEditable()) return
    const origin = [quote.originAddress, quote.originCity].filter(Boolean).join(', ')
    const destination = [lead?.destAddress, quote.destCity].filter(Boolean).join(', ') || quote.destCity || ''
    if (!origin || !destination) {
      setError('Origin address and destination are required to estimate a long-distance route.')
      return
    }

    try {
      setRouteBusy(true)
      const response = await fetch('/api/sales/route-estimate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ origin, destination, branch: lead?.branch }),
      })
      if (!response.ok) {
        const data = (await response.json()) as { error?: string }
        throw new Error(data.error || 'Route estimate failed')
      }
      const result = (await response.json()) as {
        distanceKm: number
        distanceMiles: number
        driveHours: number
        operationalDistanceKm?: number
        category: string
        originResolved: string
        destResolved: string
      }
      setLongDistanceDistanceKm(result.distanceKm)
      const operationalKm = Number(result.operationalDistanceKm || result.distanceKm || 0)
      setLongDistanceTruckCost(Number((operationalKm * Math.max(1, truckCount) * UHAUL_RATE_PER_KM).toFixed(2)))
      setRouteSummary(`${quote.originCity || 'Origin'} → ${quote.destCity || 'Destination'} · ${result.distanceKm} km · ~${result.driveHours} hr drive`)
      setError(null)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setRouteBusy(false)
    }
  }

  const isLD = lead?.moveType === 'long-distance' || quote?.moveType === 'long-distance'

  if (!params?.id) {
    return <div className="crm-shell"><h1 className="sr-only">Quote record</h1><div role="status" className="crm-panel p-16 text-center text-sm text-stone-500">Loading quote...</div></div>
  }

  if (!quote) {
    return <div className="crm-shell"><h1 className="sr-only">Quote record</h1><div role="alert" className="crm-panel p-16 text-center text-sm text-stone-500">{error || 'Quote not found'}</div></div>
  }

  const statusColors: Record<string, string> = {
    draft: 'bg-stone-100 text-stone-600',
    sent: 'bg-blue-50 text-blue-700',
    viewed: 'bg-amber-50 text-amber-700',
    accepted: 'bg-emerald-50 text-emerald-700',
    declined: 'bg-rose-50 text-rose-700',
    invoiced: 'bg-purple-50 text-purple-700',
  }

  return (
    <div className="crm-shell flex flex-col gap-0">
      {error && (
        <div className="mb-4 rounded-[8px] border border-rose-200 bg-rose-50 px-5 py-3 text-sm text-rose-700">{error}</div>
      )}
      {quoteReadOnlyReason ? (
        <div className="mb-4 rounded-[8px] border border-amber-200 bg-amber-50 px-5 py-3 text-sm text-amber-800">{quoteReadOnlyReason}</div>
      ) : null}
      {deliveryJobs.length > 0 ? (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-[8px] border border-[var(--app-line)] bg-white px-4 py-3 text-xs">
          <span className="font-semibold text-[var(--app-ink)]">Delivery:</span>
          {deliveryJobs.slice(0, 4).map(job => {
            const tone = job.status === 'sent'
              ? 'bg-emerald-50 text-emerald-700'
              : job.status === 'failed'
                ? 'bg-rose-50 text-rose-700'
                : 'bg-amber-50 text-amber-800'
            return (
              <span key={job.id} className={`rounded-full px-2.5 py-1 font-semibold ${tone}`} title={job.lastError || undefined}>
                {job.channel.toUpperCase()} · {job.status === 'pending' ? `retrying (${job.attempts}/${job.maxAttempts})` : job.status}
              </span>
            )
          })}
          {deliveryJobs.some(job => job.status === 'pending' || job.status === 'running') ? (
            <span className="text-[var(--app-muted)]">Automatic retry is active—do not resend.</span>
          ) : null}
        </div>
      ) : null}

      {/* ── PAGE HEADER ── */}
      {/* Back navigation */}
      <div className="mb-3 flex items-center gap-3">
        {lead ? (
          <button
            onClick={() => router.push(`/sales/leads/${lead.id}`)}
            className="flex items-center gap-1.5 rounded-[6px] border border-[var(--app-line)] bg-[var(--app-bg)] px-2.5 py-1.5 text-xs font-medium text-[var(--app-muted)] hover:border-[var(--app-ink)] hover:text-[var(--app-ink)] transition"
          >
            ← {lead.name || 'Back to lead'}
          </button>
        ) : (
          <button
            onClick={() => router.push('/sales')}
            className="flex items-center gap-1.5 rounded-[6px] border border-[var(--app-line)] bg-[var(--app-bg)] px-2.5 py-1.5 text-xs font-medium text-[var(--app-muted)] hover:border-[var(--app-ink)] hover:text-[var(--app-ink)] transition"
          >
            ← Dashboard
          </button>
        )}
        <button
          onClick={() => router.push('/sales/pipeline')}
          className="text-xs font-medium text-[var(--app-muted)] hover:text-[var(--app-ink)] transition"
        >
          Pipeline
        </button>
      </div>

      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-display text-xl font-semibold text-[var(--app-ink)]">
            Quote {quote.number}
          </h1>
          <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${statusColors[status] || 'bg-stone-100 text-stone-600'}`}>
            {status}
          </span>
          {(client?.name || lead?.name) && (
            <span className="text-sm text-[var(--app-muted)]">
              {client?.name || lead?.name}
            </span>
          )}
          {(quote.originCity || quote.destCity) && (
            <span className="hidden text-sm text-[var(--app-muted)] sm:inline">
              · {quote.originCity || '—'} → {quote.destCity || '—'}
            </span>
          )}
          <span className="rounded-full border border-[var(--app-line)] bg-white px-2.5 py-0.5 text-[10px] font-semibold text-[var(--app-muted)]">
            Owner: {quoteOwnerName}
          </span>
          {!canEditQuoteWorkspace ? (
            <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-[10px] font-semibold text-amber-700">
              View only
            </span>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => void copyText(acceptUrl, 'accept')} className="crm-button text-sm">
            {copied === 'accept' ? '✓ Copied' : 'Copy Link'}
          </button>

          {/* More ▾ dropdown */}
          <div className="relative">
            <button
              onClick={() => setMoreMenuOpen(open => !open)}
              onBlur={() => window.setTimeout(() => setMoreMenuOpen(false), 150)}
              className="crm-button text-sm"
            >
              More ▾
            </button>
            {moreMenuOpen && (
              <div className="absolute right-0 top-full z-20 mt-1 w-48 rounded-[8px] border border-[var(--app-line)] bg-white py-1 shadow-lg">
                <button onClick={() => { setMoreMenuOpen(false); window.print() }} className="w-full px-4 py-2 text-left text-sm hover:bg-stone-50">🖨 Print</button>
                <button onClick={() => { setMoreMenuOpen(false); setShowPreview('email'); setPreviewTab('email') }} disabled={!canEditQuoteWorkspace} className="w-full px-4 py-2 text-left text-sm hover:bg-stone-50 disabled:opacity-50">
                  {isRevision ? '✉ Resend Email Update' : '✉ Email Only'}
                </button>
                <button onClick={() => { setMoreMenuOpen(false); void markAsSentSkipEmail() }} disabled={logBusy} className="w-full px-4 py-2 text-left text-sm hover:bg-stone-50 disabled:opacity-50">
                  {logBusy ? '...' : isRevision ? '📋 Mark Update as Sent' : '📋 Mark as Sent'}
                </button>
                <button onClick={() => { setMoreMenuOpen(false); void acceptOnBehalf() }} disabled={saveBusy} className="w-full px-4 py-2 text-left text-sm hover:bg-stone-50 disabled:opacity-50">
                  {saveBusy ? '...' : '✅ Accept on Behalf'}
                </button>
              </div>
            )}
          </div>

          {/* Primary CTA */}
          {justSent ? (
            <div className="flex items-center gap-2">
              <div className="rounded-[8px] bg-emerald-600 px-4 py-2 text-sm font-semibold text-white">
                ✅ Quote queued for delivery
              </div>
              <button
                onClick={() => { window.location.href = lead ? `/sales/leads/${lead.id}` : '/sales' }}
                className="rounded-[8px] border border-emerald-600 px-4 py-2 text-sm font-semibold text-emerald-700 hover:bg-emerald-50 transition"
              >
                ← {lead ? `Back to ${lead.name}` : 'Back'}
              </button>
            </div>
          ) : (
            <button
              onClick={() => { setShowPreview('both'); setPreviewTab('email') }}
              disabled={!canEditQuoteWorkspace || sendBothBusy}
              className="rounded-[8px] bg-[var(--app-accent)] px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
            >
              {sendBothBusy ? 'Sending…' : isRevision ? 'Preview & Send Update →' : 'Preview & Send →'}
            </button>
          )}
        </div>
      </div>

      {/* ── MAIN WORKSPACE ── */}
      <div className="overflow-hidden rounded-[10px] border border-[var(--app-line)] bg-[var(--app-panel)]" style={{ minHeight: '600px' }}>
        <div className="flex h-full flex-col lg:flex-row" style={{ minHeight: '600px' }}>

          {/* ── LEFT SIDEBAR: Controls ── */}
          <aside className="w-full shrink-0 overflow-y-auto border-b border-[var(--app-line)] bg-[var(--app-bg)] lg:w-72 lg:border-b-0 lg:border-r xl:w-80">
            <fieldset disabled={!canEditQuoteWorkspace} className="space-y-6 p-5">

              {/* Move Description + Internal Notes */}
              <div className="space-y-3">
                <div>
                  <div className="crm-label mb-1.5">Move Description <span className="font-normal normal-case text-[var(--app-muted)]">on quote</span></div>
                  <textarea
                    rows={2}
                    value={quote.moveDescription || ''}
                    onChange={e => setQuote(q => q ? { ...q, moveDescription: e.target.value } : q)}
                    onBlur={() => {
                      if (!quote) return
                      void updateSalesQuote(quote.id, { moveDescription: quote.moveDescription || undefined }).catch(() => {})
                    }}
                    className="crm-input w-full resize-none text-sm"
                    placeholder={`e.g. 3-bedroom house from ${quote.originCity || 'Windsor'} to ${quote.destCity || 'destination'}`}
                  />
                </div>
                <div>
                  <div className="crm-label mb-1.5">Internal Notes <span className="font-normal normal-case text-[var(--app-muted)]">crew only</span></div>
                  <textarea
                    rows={2}
                    value={quote.internalNotes || ''}
                    onChange={e => setQuote(q => q ? { ...q, internalNotes: e.target.value } : q)}
                    onBlur={() => {
                      if (!quote) return
                      void updateSalesQuote(quote.id, { internalNotes: quote.internalNotes || undefined }).catch(() => {})
                    }}
                    className="crm-input w-full resize-none text-sm"
                    placeholder="Crew notes: tight staircase, piano needs 4 people..."
                  />
                </div>
              </div>

              {/* Pricing assumptions */}
              <div>
                <div className="crm-label mb-3">Pricing</div>
                {lineItems.some(li => li.description === 'Moving Services — Agreed Rate') && (
                  <div className="mb-3 rounded-[6px] border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] text-rose-700 font-medium">
                    ⚠ Price override active — editing crew/hours won&apos;t change the quote total. Go back to the estimate modal to adjust.
                  </div>
                )}
                <div className="space-y-3">
                  <label className="block">
                    <span className="mb-1 block text-xs text-[var(--app-muted)]">Crew Size</span>
                    <select value={crewSize} onChange={e => setCrewSize(Number(e.target.value))} className="crm-input">
                      {[1, 2, 3, 4].map(n => <option key={n} value={n}>{n} mover{n > 1 ? 's' : ''} · {formatMoney(getCrewRate(n, lead?.moveType || quote.moveType))}/hr</option>)}
                    </select>
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs text-[var(--app-muted)]">Estimated Hours</span>
                    <input type="number" min="3" step="0.25" value={estimatedHours} onChange={e => setEstimatedHours(Number(e.target.value || 3))} className="crm-input" />
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="block">
                      <span className="mb-1 block text-xs text-[var(--app-muted)]">Trucks</span>
                      <input type="number" min="1" max="4" value={truckCount} onChange={e => setTruckCount(Number(e.target.value || 1))} className="crm-input" />
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-xs text-[var(--app-muted)]">Deposit %</span>
                      <input type="number" min="0" max="100" value={depositRate} onChange={e => setDepositRate(Number(e.target.value || 0))} className="crm-input" />
                    </label>
                  </div>
                  <label className="block">
                    <span className="mb-1 block text-xs text-[var(--app-muted)]">Payment Terms</span>
                    <select value={paymentTerms || 'deposit_required'} onChange={e => setPaymentTerms(e.target.value as CRMQuote['paymentTerms'])} className="crm-input">
                      <option value="deposit_required">Deposit required</option>
                      <option value="approval_invoice">Approve scope, invoice later</option>
                      <option value="invoice_net_7">Invoice Net 7</option>
                      <option value="invoice_net_15">Invoice Net 15</option>
                      <option value="invoice_net_30">Invoice Net 30</option>
                      <option value="po_required">PO required</option>
                    </select>
                    {invoiceStyleTerms ? (
                      <span className="mt-1 block text-[11px] text-[var(--app-muted)]">
                        Customer accepts the estimate/terms first. Payment can be handled by invoice or PO.
                      </span>
                    ) : null}
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="block">
                      <span className="mb-1 block text-xs text-[var(--app-muted)]">Valid Days</span>
                      <input type="number" min="1" max="90" value={validDays} onChange={e => setValidDays(Number(e.target.value || 30))} className="crm-input" />
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-xs text-[var(--app-muted)]">Weight (lbs)</span>
                      <input type="number" min="0" step="25" value={estimatedWeightLbs} onChange={e => setEstimatedWeightLbs(Number(e.target.value || 0))} className="crm-input" />
                    </label>
                  </div>
                </div>
              </div>

              {/* Discounts */}
              <div>
                <div className="crm-label mb-3">Discount</div>
                {currentUser?.role === 'sales_rep' ? (
                  <div className="mb-2 rounded-[6px] border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] font-medium text-amber-700">
                    Sales reps can apply up to a 10% discount. Larger pricing adjustments require a manager.
                  </div>
                ) : null}
                {currentUser?.role === 'manager' ? (
                  <div className="mb-2 rounded-[6px] border border-sky-200 bg-sky-50 px-3 py-2 text-[11px] font-medium text-sky-700">
                    Managers can approve larger discounts, up to 20%, without involving the owner.
                  </div>
                ) : null}
                <div className="mb-2 flex gap-2">
                  <button onClick={() => { setDiscountAmount(Math.round(rawSubtotal * 0.1)); setDiscountLabel('10% discount') }} className="crm-button flex-1 text-xs">10% Off</button>
                  <button onClick={() => { setDiscountAmount(100); setDiscountLabel('$100 off') }} className="crm-button flex-1 text-xs">$100</button>
                  <button onClick={() => { setDiscountAmount(200); setDiscountLabel('$200 off') }} className="crm-button flex-1 text-xs">$200</button>
                </div>
                {currentUser?.role === 'sales_rep' && discountPct > 0.1 ? (
                  <div className="mb-2 rounded-[6px] border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] font-medium text-rose-700">
                    This discount is above the rep threshold and won&apos;t save until a manager or owner reviews it.
                  </div>
                ) : null}
                {discountAmount > 0 && (
                  <div className="flex items-center justify-between rounded-[6px] border border-[var(--app-line)] bg-white px-3 py-2 text-sm">
                    <span className="text-[var(--app-muted)]">{discountLabel}</span>
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-emerald-700">−{formatMoney(discountAmount)}</span>
                      <button onClick={() => setDiscountAmount(0)} className="text-[var(--app-muted)] hover:text-[var(--app-ink)]">×</button>
                    </div>
                  </div>
                )}
              </div>

              {/* Packing materials */}
              <div>
                <div className="crm-label mb-3">Add Packing</div>
                <div className="space-y-1.5">
                  {PACKING_MATERIAL_PRESETS.map(preset => (
                    <button
                      key={preset.id}
                      onClick={() => addPackingMaterial(preset.id)}
                      className="flex w-full items-center justify-between rounded-[6px] border border-[var(--app-line)] bg-white px-3 py-2 text-left transition hover:border-[var(--app-accent)]"
                    >
                      <span className="text-sm text-[var(--app-ink)]">{preset.label}</span>
                      <span className="text-xs font-medium text-[var(--app-muted)]">{formatMoney(preset.unitPrice)}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Long-distance route */}
              {isLD && (
                <div>
                  <div className="crm-label mb-3">Long Distance</div>
                  <button
                    onClick={() => void estimateRouteCosts()}
                    disabled={routeBusy}
                    className="crm-button w-full disabled:opacity-60"
                  >
                    {routeBusy ? 'Estimating...' : 'Estimate Route'}
                  </button>
                  {routeSummary && (
                    <p className="mt-2 text-xs text-[var(--app-muted)]">{routeSummary}</p>
                  )}
                  <div className="mt-3">
                    <span className="mb-1 block text-xs text-[var(--app-muted)]">Distance (km)</span>
                    <input type="number" min="0" value={longDistanceDistanceKm} onChange={e => setLongDistanceDistanceKm(Number(e.target.value))} className="crm-input" />
                  </div>
                </div>
              )}

              {/* Utility actions */}
              <div className="space-y-2 border-t border-[var(--app-line)] pt-4">
                {lead && (
                  <button onClick={rebuildFromLead} className="crm-button w-full text-sm">↺ Reset from Lead</button>
                )}
                <button onClick={addLineItem} className="crm-button w-full text-sm">+ Add Line Item</button>
                <button
                  onClick={() => void saveStatus()}
                  disabled={saveBusy}
                  className="crm-button w-full text-sm disabled:opacity-60"
                >
                  {saveBusy ? 'Saving...' : 'Save Draft'}
                </button>
              </div>

            </fieldset>
          </aside>

          {/* ── RIGHT: Line Items ── */}
          <div className="flex flex-1 flex-col overflow-hidden">

            {/* Table header */}
            <div className="grid grid-cols-[1fr_180px_110px_32px] gap-3 border-b border-[var(--app-line)] bg-[var(--app-bg)] px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[var(--app-muted)]">
              <div>Description</div>
              <div>Details</div>
              <div className="text-right">Amount</div>
              <div />
            </div>

            {/* Scrollable rows */}
            <fieldset disabled={!canEditQuoteWorkspace} className="flex-1 overflow-y-auto">
              {lineItems.length === 0 ? (
                <div className="flex h-full items-center justify-center py-20 text-sm text-[var(--app-muted)]">
                  No line items yet — use controls on the left or click &ldquo;Add Line Item&rdquo;.
                </div>
              ) : (
                <div className="divide-y divide-[var(--app-line)]">
                  {lineItems.map((item, index) => (
                    <div key={index} className="grid grid-cols-[1fr_180px_110px_32px] items-center gap-3 px-6 py-2.5 transition hover:bg-black/[0.015]">
                      <input
                        value={item.description}
                        onChange={e => updateLineItem(index, 'description', e.target.value)}
                        className="crm-input text-sm"
                        placeholder="Line item"
                      />
                      <input
                        value={item.details || ''}
                        onChange={e => updateLineItem(index, 'details', e.target.value)}
                        className="crm-input text-sm"
                        placeholder="Details"
                      />
                      <input
                        type="number"
                        value={item.amount}
                        onChange={e => updateLineItem(index, 'amount', e.target.value)}
                        className="crm-input text-right text-sm font-medium"
                        placeholder="0.00"
                      />
                      <button
                        onClick={() => removeLineItem(index)}
                        className="flex h-7 w-7 items-center justify-center rounded text-[var(--app-muted)] transition hover:bg-rose-50 hover:text-rose-500"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </fieldset>

            {/* ── TOTALS + ACTIONS BAR ── */}
            <div className="border-t border-[var(--app-line)] bg-white">
              <div className="grid grid-cols-2 gap-x-6 gap-y-1 px-6 py-4 sm:grid-cols-4">
                <div>
                  <div className="text-xs font-medium uppercase tracking-wider text-[var(--app-muted)]">Subtotal</div>
                  <div className="mt-0.5 text-lg font-semibold text-[var(--app-ink)]">{formatMoney(quoteTotals.subtotal)}</div>
                </div>
                <div>
                  <div className="text-xs font-medium uppercase tracking-wider text-[var(--app-muted)]">HST (13%)</div>
                  <div className="mt-0.5 text-lg font-semibold text-[var(--app-ink)]">{formatMoney(quoteTotals.hst)}</div>
                </div>
                <div>
                  <div className="text-xs font-medium uppercase tracking-wider text-[var(--app-muted)]">Total</div>
                  <div className="mt-0.5 text-lg font-semibold text-[var(--app-ink)]">{formatMoney(quoteTotals.total)}</div>
                </div>
                <div>
                  <div className="text-xs font-medium uppercase tracking-wider text-[var(--app-muted)]">{invoiceStyleTerms ? 'Payment Terms' : 'Deposit to Book'}</div>
                  <div className="mt-0.5 text-2xl font-bold text-[var(--app-accent)]">{formatMoney(quoteTotals.deposit)}</div>
                  {invoiceStyleTerms ? <div className="mt-1 text-xs font-semibold text-[var(--app-ink)]">{paymentTermsLabel(paymentTerms)}</div> : null}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── PREVIEW MODAL ── */}
      {showPreview && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onMouseDown={event => {
            if (event.target === event.currentTarget) closePreviewModal()
          }}
        >
          <div
            className="flex w-full max-w-3xl flex-col overflow-hidden rounded-[12px] bg-white shadow-none"
            style={{ maxHeight: '92vh' }}
            onMouseDown={event => event.stopPropagation()}
          >
            {/* Modal header */}
            <div className="flex items-center justify-between border-b border-[var(--app-line)] px-6 py-4">
              <div>
                <h2 className="text-lg font-semibold text-[var(--app-ink)]">{isRevision ? 'Preview quote update' : 'Preview before sending'}</h2>
                <p className="mt-0.5 text-sm text-[var(--app-muted)]">
                  {isRevision ? 'Review the revised customer message and same-link quote view before resending.' : 'Review what the customer will see, then send.'}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={closePreviewModal}
                  className="rounded-[6px] border border-[var(--app-line)] px-3 py-1.5 text-xs font-medium text-[var(--app-muted)] hover:border-[var(--app-ink)] hover:text-[var(--app-ink)] transition"
                >
                  ← Fix Estimate
                </button>
                <button onClick={closePreviewModal} className="flex h-8 w-8 items-center justify-center rounded-xl text-[var(--app-muted)] hover:bg-stone-100 hover:text-[var(--app-ink)]">✕</button>
              </div>
            </div>

            {/* Validation warnings */}
            {(!(client?.email || lead?.email) || !(client?.phone || lead?.phone)) && (
              <div className="border-b border-amber-200 bg-amber-50 px-6 py-3 text-sm text-amber-800">
                {!(client?.email || lead?.email) && <div>⚠ No email on file — email send will be skipped.</div>}
                {!(client?.phone || lead?.phone) && <div>⚠ No phone on file — SMS send will be skipped.</div>}
                <div className="mt-2 flex items-center justify-between gap-3">
                  <span className="text-xs text-amber-600">Add contact details on the lead to enable full delivery.</span>
                  {lead && (
                    <button
                      onClick={() => router.push(`/sales/leads/${lead.id}`)}
                      className="shrink-0 rounded-[6px] bg-amber-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-800 transition"
                    >
                      ← Add Email / Phone
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Tabs */}
            <div className="flex border-b border-[var(--app-line)] px-6">
              <button
                onClick={() => setPreviewTab('email')}
                className={`-mb-px border-b-2 px-4 py-3 text-sm font-medium transition ${previewTab === 'email' ? 'border-[var(--app-accent)] text-[var(--app-accent)]' : 'border-transparent text-[var(--app-muted)] hover:text-[var(--app-ink)]'}`}
              >
                ✉ Email
              </button>
              {showPreview === 'both' && (
                <button
                  onClick={() => setPreviewTab('sms')}
                  className={`-mb-px border-b-2 px-4 py-3 text-sm font-medium transition ${previewTab === 'sms' ? 'border-[var(--app-accent)] text-[var(--app-accent)]' : 'border-transparent text-[var(--app-muted)] hover:text-[var(--app-ink)]'}`}
                >
                  💬 SMS
                </button>
              )}
              {acceptUrl && (
                <button
                  onClick={() => setPreviewTab('quote')}
                  className={`-mb-px border-b-2 px-4 py-3 text-sm font-medium transition ${previewTab === ('quote') ? 'border-[var(--app-accent)] text-[var(--app-accent)]' : 'border-transparent text-[var(--app-muted)] hover:text-[var(--app-ink)]'}`}
                >
                  📄 Customer Quote View
                </button>
              )}
            </div>

            {/* Preview content */}
            <div className="flex-1 overflow-y-auto">
              {previewTab === ('quote') ? (
                <>
                  {Math.abs(quoteTotals.subtotal - (quote?.subtotal ?? 0)) > 0.01 && (
                    <div className="mx-4 mt-3 rounded-[8px] border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                      ⚠️ The customer view below shows the <strong>previously saved price</strong> (${(quote?.subtotal ?? 0).toFixed(2)}). The prices in the confirm section below are what will actually be sent (${quoteTotals.subtotal.toFixed(2)}).
                    </div>
                  )}
                  <iframe
                    key={`${quote?.id}-${quoteTotals.subtotal}`}
                    src={acceptUrl ? `${acceptUrl}&preview=1&_t=${encodeURIComponent(String(quote?.total ?? ''))}` : ''}
                    className="w-full border-0"
                    style={{ height: '520px' }}
                    title="Customer Quote View"
                  />
                </>
              ) : previewTab === ('email') ? (
                <div className="p-6">
                  <div className="mb-4 rounded-[8px] border border-[var(--app-line)] bg-stone-50 px-4 py-3 text-sm">
                    <div className="flex flex-wrap gap-4">
                      <span>
                        <span className="font-medium text-[var(--app-muted)]">To: </span>
                        {client?.email || lead?.email
                          ? <span className="text-[var(--app-ink)]">{client?.email || lead?.email}</span>
                          : <span className="text-amber-600 font-medium">no email on file</span>}
                      </span>
                      <span><span className="font-medium text-[var(--app-muted)]">Subject: </span>{emailSubject}</span>
                    </div>
                  </div>
                  <div
                    className="overflow-hidden rounded-[8px] border border-[var(--app-line)]"
                    dangerouslySetInnerHTML={{ __html: emailDraft.htmlBody }}
                  />
                </div>
              ) : (
                <div className="p-6">
                  <div className="mb-3 text-sm text-[var(--app-muted)]">
                    Sending to:{' '}
                    {client?.phone || lead?.phone
                      ? <span className="font-medium text-[var(--app-ink)]">{client?.phone || lead?.phone}</span>
                      : <span className="text-amber-600 font-medium">no phone on file</span>}
                  </div>
                  <div className="inline-block max-w-sm rounded-[18px] rounded-tl-[4px] bg-stone-100 px-4 py-3 text-sm leading-relaxed text-[var(--app-ink)]">
                    {smsBody}
                  </div>
                </div>
              )}
            </div>

            {/* Modal footer */}
            <div className="border-t border-[var(--app-line)] px-6 py-4 space-y-3">
              {error && (
                <div role="alert" className="rounded-[8px] border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium leading-5 text-rose-700">
                  {error}
                </div>
              )}
              {/* Price confirmation */}
              <div className="rounded-[10px] border border-[var(--app-line)] bg-[var(--app-bg)] px-4 py-3">
                <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--app-muted)] mb-2">Confirm Price Being Sent</div>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <div className="text-[10px] text-[var(--app-muted)]">Subtotal</div>
                    <div className="text-base font-semibold text-[var(--app-ink)]">{formatMoney(quoteTotals.subtotal)}</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-[var(--app-muted)]">HST (13%)</div>
                    <div className="text-base font-semibold text-[var(--app-ink)]">{formatMoney(quoteTotals.hst)}</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-[var(--app-muted)]">Total incl. HST</div>
                    <div className="text-base font-bold text-[#071421]">{formatMoney(quoteTotals.total)}</div>
                  </div>
                </div>
                <div className="mt-2 pt-2 border-t border-[var(--app-line)] flex justify-between text-xs">
                  <span className="text-[var(--app-muted)]">Deposit to book</span>
                  <span className="font-semibold text-[var(--app-ink)]">{formatMoney(quoteTotals.deposit)}</span>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <button onClick={closePreviewModal} className="crm-button">
                  Cancel
                </button>
                <button
                  onClick={async () => {
                    if (showPreview === 'both') await sendBothNow()
                    else await sendNow()
                  }}
                  disabled={!canEditQuoteWorkspace || sendBusy || sendBothBusy || (!(client?.email || lead?.email) && !(client?.phone || lead?.phone))}
                  className="rounded-[8px] bg-[var(--app-accent)] px-5 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
                >
                  {(sendBusy || sendBothBusy)
                    ? 'Sending…'
                    : showPreview === 'both'
                      ? (isRevision ? 'Confirm — Resend Email + SMS' : 'Confirm — Send Email + SMS')
                      : (isRevision ? 'Confirm — Resend Email' : 'Confirm — Send Email')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
