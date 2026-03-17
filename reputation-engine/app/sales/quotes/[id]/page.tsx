'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import { PACKING_MATERIAL_PRESETS } from '@/lib/packing-materials'
import { QUOTE_STATUSES, computeQuoteTotals, dateStamp, estimateLeadQuote, formatDate, formatMoney, getCrewRate, getDefaultDepositRate, validUntil } from '@/lib/sales'
import { fetchSalesQuote, saveSalesFollowUp, sendSalesMessage, updateSalesLead, updateSalesQuote } from '@/lib/sales-api'
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
  const [routeSummary, setRouteSummary] = useState('')
  const [emailSubject, setEmailSubject] = useState('')
  const [emailBody, setEmailBody] = useState('')
  const [smsBody, setSmsBody] = useState('')
  const [saveBusy, setSaveBusy] = useState(false)
  const [logBusy, setLogBusy] = useState(false)
  const [sendBusy, setSendBusy] = useState(false)
  const [sendBothBusy, setSendBothBusy] = useState(false)
  const [sendBothResult, setSendBothResult] = useState<{ email?: boolean; sms?: boolean } | null>(null)
  const [showPreview, setShowPreview] = useState<'both' | 'email' | null>(null)
  const [previewTab, setPreviewTab] = useState<'email' | 'sms'>('email')
  const [routeBusy, setRouteBusy] = useState(false)
  const [packingQuantities, setPackingQuantities] = useState<Record<string, number>>({})
  const [copied, setCopied] = useState<'accept' | 'email' | 'sms' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [moreMenuOpen, setMoreMenuOpen] = useState(false)
  const searchParams = useSearchParams()

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
      setDepositRate(data.quote.total > 0 ? Math.round((data.quote.deposit / data.quote.total) * 100) : getDefaultDepositRate(data.lead?.moveType || data.quote.moveType) * 100)
      setDiscountAmount(Number(data.quote.discountAmount || 0))
      setDiscountLabel(data.quote.discountLabel || 'Courtesy discount')
      setCrewSize(Number(data.quote.crewSize || 3))
      setEstimatedHours(Number(data.quote.estimatedHours || 3))
      setTruckCount(Number(data.quote.truckCount || 1))
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

  // Auto-open preview when navigated from "Preview & Send" on estimate modal
  useEffect(() => {
    if (searchParams?.get('send') === '1' && quote) {
      setShowPreview('both')
      setPreviewTab('email')
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
    }, lead.jobFactors)
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
        // Consolidated service titles
        'Full-Service Moving',
        'Long-Distance Moving Service',
        'Labor-Only Moving Crew',
        'Professional Packing Service',
        // LD operational items (if rep manually adds them)
        'One-way truck rental',
        'Fuel allowance',
        'Truck insurance allowance',
        'Long-distance misc allowance',
        'Long-distance route markup',
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
        acceptedAt: status === 'accepted' ? dateStamp() : quote.acceptedAt,
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
        sentAt: dateStamp(),
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

  async function markAsSentSkipEmail() {
    if (!quote) return
    try {
      setLogBusy(true)
      const result = await updateSalesQuote(quote.id, {
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
        sentAt: dateStamp(),
      })
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
    try {
      setSaveBusy(true)
      const result = await updateSalesQuote(quote.id, {
        status: 'accepted',
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
        sentAt: quote.sentAt || dateStamp(),
        acceptedAt: dateStamp(),
        respondedAt: new Date().toISOString(),
      })
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
    const emailTo = client?.email
    const phoneTo = client?.phone || lead?.phone
    const hasEmail = Boolean(emailTo)
    const hasPhone = Boolean(phoneTo)
    if (!hasEmail && !hasPhone) {
      setError('No email or phone on file for this client.')
      return
    }

    try {
      setSendBothBusy(true)
      setSendBothResult(null)

      const tasks: Promise<{ ok: boolean; channel: 'email' | 'sms' }>[] = []

      if (hasEmail) {
        tasks.push(
          sendSalesMessage({
            channel: 'email',
            to: emailTo!,
            subject: emailSubject,
            body: emailBody,
            htmlBody: emailDraft.htmlBody,
            leadId: lead?.id,
            quoteId: quote.id,
            notes: 'Quote email sent (send-both).',
          }).then(result => {
            mergeFollowUpLog(result.log)
            return { ok: true, channel: 'email' as const }
          }).catch(() => ({ ok: false, channel: 'email' as const }))
        )
      }

      if (hasPhone) {
        tasks.push(
          sendSalesMessage({
            channel: 'sms',
            to: phoneTo!,
            body: smsBody,
            leadId: lead?.id,
            quoteId: quote.id,
            notes: 'Quote SMS sent (send-both).',
          }).then(result => {
            mergeFollowUpLog(result.log)
            return { ok: true, channel: 'sms' as const }
          }).catch(() => ({ ok: false, channel: 'sms' as const }))
        )
      }

      const results = await Promise.allSettled(tasks)
      const resultMap: { email?: boolean; sms?: boolean } = {}
      for (const r of results) {
        if (r.status === 'fulfilled') resultMap[r.value.channel] = r.value.ok
      }
      setSendBothResult(resultMap)

      // Save quote as sent + log follow-up
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
        sentAt: dateStamp(),
      })

      let nextLead = sentResult.lead
      if (lead) {
        const followUpResult = await saveSalesFollowUp({
          leadId: lead.id,
          quoteId: quote.id,
          type: 'email',
          followUpDate,
          notes: 'Quote sent via email + SMS simultaneously.',
        })
        mergeFollowUpLog(followUpResult.log)
        const updatedLead = await updateSalesLead(lead.id, { followUpDate })
        nextLead = updatedLead
      }

      setQuote(sentResult.quote)
      setLead(nextLead)
      setStatus(sentResult.quote.status)
      setError(null)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSendBothBusy(false)
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
        sentAt: dateStamp(),
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
    const rebuilt = estimateLeadQuote(lead, undefined, lead.jobFactors)
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
        body: JSON.stringify({ origin, destination }),
      })
      if (!response.ok) {
        const data = (await response.json()) as { error?: string }
        throw new Error(data.error || 'Route estimate failed')
      }
      const result = (await response.json()) as {
        distanceKm: number
        distanceMiles: number
        driveHours: number
        category: string
        originResolved: string
        destResolved: string
      }
      setLongDistanceDistanceKm(result.distanceKm)
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
    return <div className="crm-shell"><div className="crm-panel p-16 text-center text-sm text-stone-500">Loading quote...</div></div>
  }

  if (!quote) {
    return <div className="crm-shell"><div className="crm-panel p-16 text-center text-sm text-stone-500">{error || 'Quote not found'}</div></div>
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

      {/* ── PAGE HEADER ── */}
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
                <button onClick={() => { setMoreMenuOpen(false); setShowPreview('email'); setPreviewTab('email') }} className="w-full px-4 py-2 text-left text-sm hover:bg-stone-50">✉ Email Only</button>
                <button onClick={() => { setMoreMenuOpen(false); void markAsSentSkipEmail() }} disabled={logBusy} className="w-full px-4 py-2 text-left text-sm hover:bg-stone-50 disabled:opacity-50">
                  {logBusy ? '...' : '📋 Mark as Sent'}
                </button>
                <button onClick={() => { setMoreMenuOpen(false); void acceptOnBehalf() }} disabled={saveBusy} className="w-full px-4 py-2 text-left text-sm hover:bg-stone-50 disabled:opacity-50">
                  {saveBusy ? '...' : '✅ Accept on Behalf'}
                </button>
              </div>
            )}
          </div>

          {/* Primary CTA */}
          <button
            onClick={() => { setShowPreview('both'); setPreviewTab('email') }}
            disabled={sendBothBusy}
            className="rounded-[8px] bg-[var(--app-accent)] px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
          >
            {sendBothBusy ? 'Sending…' : 'Preview & Send →'}
          </button>
        </div>
      </div>

      {/* ── MAIN WORKSPACE ── */}
      <div className="overflow-hidden rounded-[10px] border border-[var(--app-line)] bg-[var(--app-panel)]" style={{ minHeight: '600px' }}>
        <div className="flex h-full flex-col lg:flex-row" style={{ minHeight: '600px' }}>

          {/* ── LEFT SIDEBAR: Controls ── */}
          <aside className="w-full shrink-0 overflow-y-auto border-b border-[var(--app-line)] bg-[var(--app-bg)] lg:w-72 lg:border-b-0 lg:border-r xl:w-80">
            <div className="space-y-6 p-5">

              {/* Pricing assumptions */}
              <div>
                <div className="crm-label mb-3">Pricing</div>
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
                <div className="mb-2 flex gap-2">
                  <button onClick={() => { setDiscountAmount(Math.round(rawSubtotal * 0.1)); setDiscountLabel('10% discount') }} className="crm-button flex-1 text-xs">10% Off</button>
                  <button onClick={() => { setDiscountAmount(100); setDiscountLabel('$100 off') }} className="crm-button flex-1 text-xs">$100</button>
                  <button onClick={() => { setDiscountAmount(200); setDiscountLabel('$200 off') }} className="crm-button flex-1 text-xs">$200</button>
                </div>
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
                  {PACKING_MATERIAL_PRESETS.slice(0, 6).map(preset => (
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

            </div>
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
            <div className="flex-1 overflow-y-auto">
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
            </div>

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
                  <div className="text-xs font-medium uppercase tracking-wider text-[var(--app-muted)]">Deposit to Book</div>
                  <div className="mt-0.5 text-2xl font-bold text-[var(--app-accent)]">{formatMoney(quoteTotals.deposit)}</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── PREVIEW MODAL ── */}
      {showPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="flex w-full max-w-3xl flex-col overflow-hidden rounded-[12px] bg-white shadow-2xl" style={{ maxHeight: '92vh' }}>
            {/* Modal header */}
            <div className="flex items-center justify-between border-b border-[var(--app-line)] px-6 py-4">
              <div>
                <h2 className="text-lg font-semibold text-[var(--app-ink)]">Preview before sending</h2>
                <p className="mt-0.5 text-sm text-[var(--app-muted)]">Review what the customer will see, then send.</p>
              </div>
              <button onClick={() => setShowPreview(null)} className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--app-muted)] hover:bg-stone-100 hover:text-[var(--app-ink)]">✕</button>
            </div>

            {/* Validation warnings */}
            {(!(client?.email || lead?.email) || !(client?.phone || lead?.phone)) && (
              <div className="border-b border-amber-200 bg-amber-50 px-6 py-3 text-sm text-amber-800">
                {!(client?.email || lead?.email) && <div>⚠ No email on file — email send will be skipped.</div>}
                {!(client?.phone || lead?.phone) && <div>⚠ No phone on file — SMS send will be skipped.</div>}
                <div className="mt-1 text-xs text-amber-600">Go back to the lead and add contact details to enable full delivery.</div>
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
                  onClick={() => setPreviewTab('quote' as 'email')}
                  className={`-mb-px border-b-2 px-4 py-3 text-sm font-medium transition ${previewTab === ('quote' as 'email') ? 'border-[var(--app-accent)] text-[var(--app-accent)]' : 'border-transparent text-[var(--app-muted)] hover:text-[var(--app-ink)]'}`}
                >
                  📄 Customer Quote View
                </button>
              )}
            </div>

            {/* Preview content */}
            <div className="flex-1 overflow-y-auto">
              {previewTab === ('quote' as 'email') ? (
                <iframe
                  src={acceptUrl}
                  className="w-full border-0"
                  style={{ height: '520px' }}
                  title="Customer Quote View"
                />
              ) : previewTab === 'email' ? (
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
            <div className="flex items-center justify-between border-t border-[var(--app-line)] px-6 py-4">
              <button onClick={() => setShowPreview(null)} className="crm-button">
                Cancel
              </button>
              <button
                onClick={async () => {
                  setShowPreview(null)
                  if (showPreview === 'both') await sendBothNow()
                  else await sendNow()
                }}
                disabled={sendBusy || sendBothBusy || (!(client?.email || lead?.email) && !(client?.phone || lead?.phone))}
                className="rounded-[8px] bg-[var(--app-accent)] px-5 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
              >
                {(sendBusy || sendBothBusy) ? 'Sending…' : showPreview === 'both' ? 'Confirm — Send Email + SMS' : 'Confirm — Send Email'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
