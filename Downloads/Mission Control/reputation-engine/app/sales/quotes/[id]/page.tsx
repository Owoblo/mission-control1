'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import { PACKING_MATERIAL_PRESETS } from '@/lib/packing-materials'
import { QUOTE_STATUSES, computeQuoteTotals, estimateLeadQuote, formatDate, formatMoney, getCrewRate, getDefaultDepositRate, validUntil } from '@/lib/sales'
import { estimateSalesRoute, fetchSalesQuote, saveSalesFollowUp, sendSalesMessage, updateSalesLead, updateSalesQuote } from '@/lib/sales-api'
import type { CRMClient, CRMLead, CRMQuote, FollowUpLog, QuoteLineItem } from '@/lib/types'

function plusDays(days: number) {
  const date = new Date()
  date.setDate(date.getDate() + days)
  return date.toISOString().slice(0, 10)
}

function buildQuoteEmailHtml({
  customerName,
  quoteNumber,
  moveDate,
  originCity,
  destCity,
  total,
  deposit,
  acceptUrl,
  validUntilText,
}: {
  customerName: string
  quoteNumber: string
  moveDate?: string
  originCity?: string
  destCity?: string
  total: number
  deposit: number
  acceptUrl: string
  validUntilText: string
}) {
  return `
  <div style="background:#f7f4ee;padding:32px 16px;font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#171717;">
    <div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #e9e4d9;border-radius:18px;overflow:hidden;">
      <div style="padding:28px 32px;border-bottom:1px solid #eee7da;">
        <div style="font-size:12px;letter-spacing:.18em;text-transform:uppercase;color:#7c766a;font-weight:700;">Saturn Star Moving</div>
        <h1 style="margin:14px 0 8px;font-size:30px;line-height:1.1;color:#171717;">Your quote is ready.</h1>
        <p style="margin:0;font-size:15px;line-height:1.7;color:#4b5563;">Hi ${customerName}, we prepared your moving estimate and linked everything below for quick review.</p>
      </div>
      <div style="padding:28px 32px;">
        <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;margin-bottom:24px;">
          <div style="padding:16px;border:1px solid #eee7da;border-radius:14px;background:#fcfbf8;">
            <div style="font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:#8a8478;font-weight:700;">Quote</div>
            <div style="margin-top:8px;font-size:18px;font-weight:700;color:#171717;">${quoteNumber}</div>
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
            <div style="font-size:11px;letter-spacing:.16em;text-transform:uppercase;opacity:.74;font-weight:700;">Estimated Total</div>
            <div style="margin-top:8px;font-size:30px;font-weight:700;">${formatMoney(total)}</div>
          </div>
          <div style="padding:18px;border-radius:14px;background:#f4efe4;border:1px solid #eee7da;">
            <div style="font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:#8a8478;font-weight:700;">Deposit To Book</div>
            <div style="margin-top:8px;font-size:30px;font-weight:700;color:#171717;">${formatMoney(deposit)}</div>
          </div>
        </div>
        <div style="margin-bottom:18px;font-size:15px;line-height:1.7;color:#374151;">Review the full quote online, accept or decline it, and print or save a PDF from the quote page if you need a document copy.</div>
        <div style="margin-bottom:28px;">
          <a href="${acceptUrl}" style="display:inline-block;padding:14px 22px;border-radius:999px;background:#0f6a53;color:#ffffff;text-decoration:none;font-weight:700;">Open Quote</a>
        </div>
        <div style="padding-top:18px;border-top:1px solid #eee7da;font-size:13px;line-height:1.8;color:#6b7280;">
          This pricing is based on the inventory and access details currently on file. Reply to this email if you want any adjustments before booking.
        </div>
      </div>
    </div>
  </div>`
}

export default function SalesQuoteDetailPage() {
  const params = useParams() as { id?: string }
  const [quote, setQuote] = useState<CRMQuote | null>(null)
  const [lead, setLead] = useState<CRMLead | null>(null)
  const [client, setClient] = useState<CRMClient | null>(null)
  const [followUps, setFollowUps] = useState<FollowUpLog[]>([])
  const [status, setStatus] = useState<CRMQuote['status']>('draft')
  const [followUpDate, setFollowUpDate] = useState(plusDays(3))
  const [sendChannel, setSendChannel] = useState<'email' | 'sms'>('email')
  const [lineItems, setLineItems] = useState<QuoteLineItem[]>([])
  const [validDays, setValidDays] = useState(30)
  const [depositRate, setDepositRate] = useState(40)
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
  const [truckMpg, setTruckMpg] = useState(10)
  const [gasPricePerGallon, setGasPricePerGallon] = useState(4.75)
  const [routeSummary, setRouteSummary] = useState('')
  const [emailSubject, setEmailSubject] = useState('')
  const [emailBody, setEmailBody] = useState('')
  const [smsBody, setSmsBody] = useState('')
  const [saveBusy, setSaveBusy] = useState(false)
  const [logBusy, setLogBusy] = useState(false)
  const [sendBusy, setSendBusy] = useState(false)
  const [routeBusy, setRouteBusy] = useState(false)
  const [packingQuantities, setPackingQuantities] = useState<Record<string, number>>({})
  const [copied, setCopied] = useState<'accept' | 'email' | 'sms' | null>(null)
  const [error, setError] = useState<string | null>(null)

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
      setDepositRate(data.quote.total > 0 ? Math.round((data.quote.deposit / data.quote.total) * 100) : 40)
      setDiscountAmount(Number(data.quote.discountAmount || 0))
      setDiscountLabel(data.quote.discountLabel || 'Courtesy discount')
      setCrewSize(Number(data.quote.crewSize || 3))
      setEstimatedHours(Number(data.quote.estimatedHours || 3))
      setTruckCount(Number(data.quote.truckCount || 1))
      setEstimatedWeightLbs(Number(data.quote.estimatedWeightLbs || data.lead?.totalWeightLbs || 0))
      setLongDistanceDistanceKm(Number(data.quote.longDistanceDistanceKm || 0))
      setLongDistanceTruckCost(Number(data.quote.longDistanceTruckCost || 0))
      setLongDistanceGasCost(Number(data.quote.longDistanceGasCost || 0))
      setLongDistanceInsuranceCost(Number(data.quote.longDistanceInsuranceCost || 150))
      setLongDistanceMiscCost(Number(data.quote.longDistanceMiscCost || 150))
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
    return `${window.location.origin}/quote-accept?id=${encodeURIComponent(quote.id)}&token=${encodeURIComponent(quote.acceptToken)}`
  }, [quote])

  const emailDraft = useMemo(() => {
    if (!quote) return { subject: '', body: '', htmlBody: '', href: '#' }
    const firstName = (client?.name || lead?.name || 'there').split(' ')[0]
    const subject = `Your moving quote from Saturn Star (${quote.number})`
    const body = `Hi ${firstName},

Your binding hourly estimate is ready.

Quote #: ${quote.number}
Move Date: ${formatDate(quote.moveDate)}
Total: ${formatMoney(quote.total)}
Deposit to book: ${formatMoney(quote.deposit)}

Review and confirm here:
${acceptUrl}

This quote is valid until ${validUntil(quote)}.
This pricing is based on the confirmed inventory and access details currently on file.

Reply to this message if you want anything adjusted.

Saturn Star Movers`

    return {
      subject,
      body,
      htmlBody: buildQuoteEmailHtml({
        customerName: firstName,
        quoteNumber: quote.number,
        moveDate: formatDate(quote.moveDate),
        originCity: quote.originCity,
        destCity: quote.destCity,
        total: quote.total,
        deposit: quote.deposit,
        acceptUrl,
        validUntilText: validUntil(quote),
      }),
      href: `mailto:${client?.email || ''}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`,
    }
  }, [acceptUrl, client?.email, client?.name, lead?.name, quote])

  const smsDraft = useMemo(() => {
    if (!quote) return ''
    const firstName = (client?.name || lead?.name || 'there').split(' ')[0]
    return `Hi ${firstName}, your Saturn Star binding hourly estimate ${quote.number} is ready. Total ${formatMoney(quote.total)}. Deposit to book ${formatMoney(quote.deposit)}. Review here: ${acceptUrl}`
  }, [acceptUrl, client?.name, lead?.name, quote])

  useEffect(() => {
    setEmailSubject(emailDraft.subject)
    setEmailBody(emailDraft.body)
  }, [emailDraft.body, emailDraft.subject])

  useEffect(() => {
    setSmsBody(smsDraft)
  }, [smsDraft])

  const quoteTotals = useMemo(
    () => computeQuoteTotals(lineItems, Math.max(0, Math.min(100, depositRate)) / 100, Math.max(0, discountAmount)),
    [depositRate, discountAmount, lineItems]
  )
  const rawSubtotal = useMemo(() => lineItems.reduce((sum, item) => sum + Number(item.amount || 0), 0), [lineItems])
  const crewRate = useMemo(() => getCrewRate(crewSize, lead?.moveType || quote?.moveType), [crewSize, lead?.moveType, quote?.moveType])

  useEffect(() => {
    if (!lead || !quote) return
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
    })
    setLineItems(current => {
      const dynamicDescriptions = new Set([
        'Local moving labor',
        'Long-distance moving labor',
        'Labor-only moving crew',
        'Packing labor',
        'Dispatch and route coverage',
        'Portal-to-portal travel allowance',
        'Mileage and linehaul',
        'Additional truck and crew package',
      ])
      const manualItems = current.filter(item => !dynamicDescriptions.has(item.description))
      return [...rebuilt.lineItems, ...manualItems]
    })
  }, [crewSize, estimatedHours, truckCount, estimatedWeightLbs, longDistanceDistanceKm, longDistanceTruckCost, longDistanceGasCost, longDistanceInsuranceCost, longDistanceMiscCost, longDistanceMarkupRate, lead, quote])

  async function copyText(value: string, kind: 'accept' | 'email' | 'sms') {
    await navigator.clipboard.writeText(value)
    setCopied(kind)
    window.setTimeout(() => setCopied(null), 1400)
  }

  async function saveStatus() {
    if (!quote) return
    try {
      setSaveBusy(true)
      const result = await updateSalesQuote(quote.id, {
        status,
        lineItems: quoteTotals.lineItems,
        subtotal: quoteTotals.subtotal,
        hst: quoteTotals.hst,
        total: quoteTotals.total,
        deposit: quoteTotals.deposit,
        balance: quoteTotals.balance,
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
        validDays,
        acceptedAt: status === 'accepted' ? new Date().toISOString().slice(0, 10) : quote.acceptedAt,
        respondedAt: ['accepted', 'declined'].includes(status) ? new Date().toISOString() : quote.respondedAt,
      })
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
    try {
      setLogBusy(true)
      const sentResult = await updateSalesQuote(quote.id, {
        status: 'sent',
        lineItems: quoteTotals.lineItems,
        subtotal: quoteTotals.subtotal,
        hst: quoteTotals.hst,
        total: quoteTotals.total,
        deposit: quoteTotals.deposit,
        balance: quoteTotals.balance,
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
        validDays,
        sentAt: new Date().toISOString().slice(0, 10),
      })

      let nextLead = sentResult.lead
      if (lead) {
        const followUpResult = await saveSalesFollowUp({
          leadId: lead.id,
          quoteId: quote.id,
          type: sendChannel,
          followUpDate,
          notes: `${sendChannel === 'email' ? 'Quote emailed' : 'Quote texted'} with acceptance link.`,
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

  async function sendNow() {
    if (!quote) return
    const to = sendChannel === 'email' ? client?.email : client?.phone
    const body = sendChannel === 'email' ? emailBody : smsBody
    const subject = sendChannel === 'email' ? emailSubject : undefined
    if (!to || !body) return

    try {
      setSendBusy(true)
      const messageResult = await sendSalesMessage({
        channel: sendChannel,
        to,
        subject,
        body,
        htmlBody: sendChannel === 'email' ? emailDraft.htmlBody : undefined,
        leadId: lead?.id,
        quoteId: quote.id,
        notes: `${sendChannel === 'email' ? 'Quote email sent' : 'Quote SMS sent'} from sales quote page.`,
      })
      mergeFollowUpLog(messageResult.log)

      const sentResult = await updateSalesQuote(quote.id, {
        status: 'sent',
        lineItems: quoteTotals.lineItems,
        subtotal: quoteTotals.subtotal,
        hst: quoteTotals.hst,
        total: quoteTotals.total,
        deposit: quoteTotals.deposit,
        balance: quoteTotals.balance,
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
        validDays,
        sentAt: new Date().toISOString().slice(0, 10),
      })

      let nextLead = sentResult.lead
      if (lead) {
        const followUpResult = await saveSalesFollowUp({
          leadId: lead.id,
          quoteId: quote.id,
          type: sendChannel,
          followUpDate,
          notes: `${sendChannel === 'email' ? 'Quote emailed' : 'Quote texted'} with acceptance link.`,
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
      setSendBusy(false)
    }
  }

  function updateLineItem(index: number, field: keyof QuoteLineItem, value: string) {
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
    setLineItems(current => [...current, { description: '', details: '', amount: 0 }])
  }

  function removeLineItem(index: number) {
    setLineItems(current => current.filter((_, itemIndex) => itemIndex !== index))
  }

  function addPackingMaterial(presetId: string) {
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
    const rebuilt = estimateLeadQuote(lead)
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
    const origin = [quote.originAddress, quote.originCity].filter(Boolean).join(', ')
    const destination = quote.destCity || ''
    if (!origin || !destination) {
      setError('Origin address and destination are required to estimate a long-distance route.')
      return
    }

    try {
      setRouteBusy(true)
      const result = await estimateSalesRoute({
        origin,
        destination,
        truckMpg,
        gasPricePerGallon,
        truckCount,
      })
      setLongDistanceDistanceKm(result.distanceKm)
      setLongDistanceGasCost(result.fuelCost)
      setRouteSummary(result.routeText)
      setTruckMpg(result.truckMpg)
      setGasPricePerGallon(result.gasPricePerGallon)
      setError(null)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setRouteBusy(false)
    }
  }

  if (!params?.id) {
    return <div className="crm-shell"><div className="crm-panel p-16 text-center text-sm text-stone-500">Loading quote...</div></div>
  }

  if (!quote) {
    return <div className="crm-shell"><div className="crm-panel p-16 text-center text-sm text-stone-500">{error || 'Quote not found'}</div></div>
  }

  return (
    <div className="crm-shell space-y-5">
      {error && <div className="rounded-[8px] border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-700">{error}</div>}

      <div className="overflow-hidden rounded-[8px] border border-[var(--app-line)] bg-[var(--app-panel)]">
        <div className="grid min-h-[760px] xl:grid-cols-2">
          <section className="border-r border-[var(--app-line)] bg-[var(--app-panel)]">
            <div className="border-b border-[var(--app-line)] p-6">
              <h1 className="font-display text-2xl font-semibold text-[var(--app-ink)]">Inventory Search</h1>
              <div className="relative mt-4">
                <input className="crm-input h-12 pl-11" placeholder="Search items, e.g., Sofa, Boxes..." />
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--app-muted)]">⌕</span>
              </div>
              {lead ? (
                <div className="mt-4 flex items-center gap-2 text-sm text-[var(--app-muted)]">
                  <span>Lead: {lead.name}</span>
                  <span>•</span>
                  <span>{quote.originCity || 'Origin'} → {quote.destCity || 'Destination'}</span>
                </div>
              ) : null}
            </div>

            <div className="space-y-8 p-6">
              <section>
                <div className="crm-label">Popular Items</div>
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  {PACKING_MATERIAL_PRESETS.slice(0, 4).map(preset => (
                    <button key={preset.id} onClick={() => addPackingMaterial(preset.id)} className="flex items-center justify-between rounded-[8px] border border-[var(--app-line)] bg-[var(--app-panel)] p-3 text-left transition hover:border-[var(--app-ink)]">
                      <span>
                        <span className="block text-sm font-medium text-[var(--app-ink)]">{preset.label}</span>
                        <span className="mt-1 block text-xs text-[var(--app-muted)]">{preset.description}</span>
                      </span>
                      <span className="text-sm font-medium text-[var(--app-ink)]">{formatMoney(preset.unitPrice)}</span>
                    </button>
                  ))}
                </div>
              </section>

              <section>
                <div className="crm-label">Quote Actions</div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {lead ? <button onClick={rebuildFromLead} className="crm-button">Reset From Lead</button> : null}
                  <button onClick={addLineItem} className="crm-button">Add Line Item</button>
                  {(lead?.moveType === 'long-distance' || quote.moveType === 'long-distance') ? (
                    <button onClick={() => void estimateRouteCosts()} disabled={routeBusy} className="crm-button disabled:opacity-60">
                      {routeBusy ? 'Estimating...' : 'Estimate Route'}
                    </button>
                  ) : null}
                  <button onClick={() => void saveStatus()} disabled={saveBusy} className="crm-button-dark disabled:opacity-60">
                    {saveBusy ? 'Saving...' : 'Save Draft'}
                  </button>
                </div>
              </section>

              <section>
                <div className="crm-label">Pricing Assumptions</div>
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <label>
                    <span className="crm-label">Crew Size</span>
                    <select value={crewSize} onChange={event => setCrewSize(Number(event.target.value || 3))} className="crm-input mt-2">
                      {[1, 2, 3, 4].map(size => (
                        <option key={size} value={size}>{size} mover{size > 1 ? 's' : ''}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span className="crm-label">Estimated Hours</span>
                    <input type="number" min="3" step="0.25" value={estimatedHours} onChange={event => setEstimatedHours(Number(event.target.value || 3))} className="crm-input mt-2" />
                  </label>
                  <label>
                    <span className="crm-label">Truck Count</span>
                    <input type="number" min="1" max="4" value={truckCount} onChange={event => setTruckCount(Number(event.target.value || 1))} className="crm-input mt-2" />
                  </label>
                  <label>
                    <span className="crm-label">Estimated Weight (lbs)</span>
                    <input type="number" min="0" step="25" value={estimatedWeightLbs} onChange={event => setEstimatedWeightLbs(Number(event.target.value || 0))} className="crm-input mt-2" />
                  </label>
                  <label>
                    <span className="crm-label">Deposit %</span>
                    <input type="number" min="0" max="100" value={depositRate} onChange={event => setDepositRate(Number(event.target.value || 0))} className="crm-input mt-2" />
                  </label>
                  <label>
                    <span className="crm-label">Valid Days</span>
                    <input type="number" min="1" max="90" value={validDays} onChange={event => setValidDays(Number(event.target.value || 30))} className="crm-input mt-2" />
                  </label>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button onClick={() => { setDiscountAmount(Math.round(rawSubtotal * 0.1)); setDiscountLabel('10% discount') }} className="crm-button">10% Off</button>
                  <button onClick={() => { setDiscountAmount(100); setDiscountLabel('$100 off') }} className="crm-button">$100 Off</button>
                  <button onClick={() => { setDiscountAmount(200); setDiscountLabel('$200 off') }} className="crm-button">$200 Off</button>
                </div>
              </section>
            </div>
          </section>

          <section className="relative flex flex-col bg-[var(--app-bg)]">
            <div className="flex items-center justify-between border-b border-[var(--app-line)] bg-[var(--app-panel)] px-8 py-6">
              <div>
                <h2 className="font-display text-2xl font-semibold text-[var(--app-ink)]">Current Manifest</h2>
                <div className="mt-1 text-sm text-[var(--app-muted)]">{client?.name || lead?.name || 'Unknown client'} • {quote.originCity || 'Origin'} → {quote.destCity || 'Destination'}</div>
              </div>
              <button onClick={() => setLineItems([])} className="text-sm font-medium text-[var(--app-muted)] transition hover:text-[var(--app-ink)]">Clear All</button>
            </div>

            <div className="flex-1 overflow-y-auto px-8 py-6 pb-44">
              <div className="grid grid-cols-12 gap-4 border-b border-[var(--app-line)] pb-3 text-xs font-medium uppercase tracking-wider text-[var(--app-muted)]">
                <div className="col-span-5">Item</div>
                <div className="col-span-3 text-center">Details</div>
                <div className="col-span-2 text-center">Qty</div>
                <div className="col-span-2 text-right">Amount</div>
              </div>
              <div className="mt-2 space-y-1">
                {lineItems.map((item, index) => (
                  <div key={`${item.description}-${index}`} className="grid grid-cols-12 items-center gap-4 rounded px-2 py-3 transition hover:bg-black/[0.02]">
                    <div className="col-span-5">
                      <input
                        value={item.description}
                        onChange={event => updateLineItem(index, 'description', event.target.value)}
                        className="crm-input"
                        placeholder="Line item"
                      />
                    </div>
                    <div className="col-span-3">
                      <input
                        value={item.details || ''}
                        onChange={event => updateLineItem(index, 'details', event.target.value)}
                        className="crm-input"
                        placeholder="What this covers"
                      />
                    </div>
                  <div className="col-span-2 flex justify-center">
                      <div className="flex h-8 items-center rounded-[6px] border border-[var(--app-line)] bg-[var(--app-panel)]">
                        <button className="flex h-full w-8 items-center justify-center text-[var(--app-muted)]" onClick={() => updateLineItem(index, 'amount', String(Math.max(0, Number(item.amount) - 25)))}>−</button>
                        <div className="flex h-full w-10 items-center justify-center border-x border-[var(--app-line)] text-sm font-medium text-[var(--app-ink)]">1</div>
                        <button className="flex h-full w-8 items-center justify-center text-[var(--app-muted)]" onClick={() => updateLineItem(index, 'amount', String(Number(item.amount) + 25))}>＋</button>
                      </div>
                    </div>
                    <div className="col-span-2 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <input
                          type="number"
                          value={item.amount}
                          onChange={event => updateLineItem(index, 'amount', event.target.value)}
                          className="crm-input max-w-[120px] text-right"
                          placeholder="Amount"
                        />
                        <button onClick={() => removeLineItem(index)} className="text-xs text-[var(--app-muted)] hover:text-[var(--app-ink)]">×</button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              {aiQuoteNote(quote.moveType, routeSummary)}
            </div>

            <div className="absolute bottom-0 left-0 right-0 border-t border-[var(--app-line)] bg-[var(--app-panel)] shadow-[0_-10px_40px_rgba(0,0,0,0.03)]">
              <div className="px-8 py-5">
                <div className="mb-5 grid gap-6 md:grid-cols-4">
                  <div>
                    <div className="text-xs font-medium uppercase tracking-wider text-[var(--app-muted)]">Subtotal</div>
                    <div className="mt-1 text-xl font-semibold text-[var(--app-ink)]">{formatMoney(quoteTotals.subtotal)}</div>
                  </div>
                  <div>
                    <div className="text-xs font-medium uppercase tracking-wider text-[var(--app-muted)]">Est. Weight</div>
                    <div className="mt-1 text-xl font-semibold text-[var(--app-ink)]">{estimatedWeightLbs || 0} lbs</div>
                  </div>
                  <div>
                    <div className="text-xs font-medium uppercase tracking-wider text-[var(--app-muted)]">Crew Rate</div>
                    <div className="mt-1 text-xl font-semibold text-[var(--app-ink)]">{formatMoney(crewRate)}/hr</div>
                  </div>
                  <div>
                    <div className="text-xs font-medium uppercase tracking-wider text-[var(--app-muted)]">Estimated Total</div>
                    <div className="mt-1 text-xl font-semibold text-[var(--app-ink)]">{formatMoney(quoteTotals.total)}</div>
                  </div>
                </div>
                <div className="flex items-center justify-between border-t border-[var(--app-line)] pt-4">
                  <div>
                    <div className="text-sm text-[var(--app-muted)]">Deposit</div>
                    <div className="text-3xl font-bold tracking-tight text-[var(--app-ink)]">{formatMoney(quoteTotals.deposit)}</div>
                  </div>
                  <div className="flex gap-3">
                    <button onClick={() => void copyText(acceptUrl, 'accept')} className="crm-button">{copied === 'accept' ? 'Copied' : 'Copy Link'}</button>
                    <button onClick={() => void sendNow()} disabled={sendBusy} className="crm-button disabled:opacity-60">{sendBusy ? 'Sending...' : 'Send Quote'}</button>
                    <button onClick={() => void logDraftAsSent()} disabled={logBusy} className="crm-button-dark disabled:opacity-60">
                      {logBusy ? 'Logging...' : 'Generate Quote'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}

function aiQuoteNote(moveType?: string, routeSummary?: string) {
  return (
    <div className="mt-8 rounded-[8px] border border-[rgba(34,72,56,0.18)] bg-[rgba(34,72,56,0.06)] p-4">
      <div className="crm-label">Quote Context</div>
      <div className="mt-2 text-sm leading-6 text-[var(--app-ink)]">
        {moveType === 'long-distance'
          ? routeSummary || 'Long-distance pricing is using the current route assumptions, linehaul inputs, and markup settings.'
          : 'This estimate is using the current labor assumptions, truck count, discounts, and deposit logic.'}
      </div>
    </div>
  )
}
