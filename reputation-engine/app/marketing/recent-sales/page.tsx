'use client'

import { useEffect, useMemo, useState } from 'react'
import { Check, MapPin, MessageSquareText, Search, X } from 'lucide-react'
import { useRouter } from 'next/navigation'

type SaleSignal = {
  id: string
  address: string
  city?: string | null
  mls_id?: string | null
  sold_verified_at?: string | null
  verification_source?: string | null
  verification_confidence?: number | null
  realtor_name: string
  realtor_role?: string | null
  realtor_brokerage?: string | null
  contact_id?: string | null
  match_score?: number | null
  match_reasons?: string[]
  relationship_tier: string
  suggested_message?: string | null
  status: string
}

type ContactResult = {
  id: string
  name: string
  company?: string | null
  city?: string | null
  phone?: string | null
}

const STATUS_LABEL: Record<string, string> = {
  needs_match: 'Needs match',
  needs_review: 'Needs review',
  ready: 'Ready',
  scheduled: 'Scheduled',
  sent: 'Sent',
  dismissed: 'Dismissed',
}

function saleStatusLabel(sale: SaleSignal) {
  if (sale.realtor_name === 'Realtor not identified') return 'Needs Realtor'
  return STATUS_LABEL[sale.status] || sale.status
}

function dateLabel(value?: string | null) {
  if (!value) return 'Verification date unavailable'
  return new Intl.DateTimeFormat('en-CA', { month: 'short', day: 'numeric', year: 'numeric' })
    .format(new Date(value))
}

export default function RecentSalesPage() {
  const router = useRouter()
  const [sales, setSales] = useState<SaleSignal[]>([])
  const [loading, setLoading] = useState(true)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('open')
  const [saleAge, setSaleAge] = useState<'all' | '7' | '30' | 'older30'>('all')
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const [scheduleAt, setScheduleAt] = useState('')
  const [matchQuery, setMatchQuery] = useState('')
  const [matchResults, setMatchResults] = useState<ContactResult[]>([])
  const [matching, setMatching] = useState(false)

  async function load() {
    setLoading(true)
    const response = await fetch('/api/marketing/recent-sales', { credentials: 'include' })
    if (response.ok) {
      const rows = await response.json() as SaleSignal[]
      setSales(rows)
      if (!activeId && rows[0]) setActiveId(rows[0].id)
    }
    setLoading(false)
  }

  useEffect(() => { void load() }, [])

  const visible = useMemo(() => sales.filter(sale => {
    if (status === 'open' && ['sent', 'dismissed'].includes(sale.status)) return false
    if (status !== 'open' && status !== 'all' && sale.status !== status) return false
    if (saleAge !== 'all') {
      const soldAt = sale.sold_verified_at ? new Date(sale.sold_verified_at).getTime() : 0
      const ageDays = soldAt ? (Date.now() - soldAt) / 86_400_000 : Number.POSITIVE_INFINITY
      if (saleAge === '7' && ageDays > 7) return false
      if (saleAge === '30' && ageDays > 30) return false
      if (saleAge === 'older30' && ageDays <= 30) return false
    }
    const haystack = `${sale.realtor_name} ${sale.realtor_brokerage || ''} ${sale.address} ${sale.city || ''}`.toLowerCase()
    return !query.trim() || haystack.includes(query.trim().toLowerCase())
  }), [query, saleAge, sales, status])

  const active = sales.find(sale => sale.id === activeId) || visible[0] || null

  useEffect(() => {
    setDraft(active?.suggested_message || '')
    setScheduleAt('')
    setMatchQuery(active?.realtor_name || '')
    setMatchResults([])
    setNotice('')
  }, [active?.id])

  async function searchContacts() {
    if (!matchQuery.trim()) return
    setMatching(true)
    const response = await fetch(`/api/marketing/contacts?mode=directory&limit=20&q=${encodeURIComponent(matchQuery.trim())}`, { credentials: 'include' })
    const result = await response.json().catch(() => ({})) as { contacts?: ContactResult[] }
    setMatchResults(response.ok ? result.contacts || [] : [])
    setMatching(false)
  }

  async function linkContact(contact: ContactResult) {
    if (!active) return
    setBusy('match')
    try {
      await patch(active.id, { contact_id: contact.id })
      setNotice(`Matched to ${contact.name}. Review the refreshed relationship message before sending.`)
      setMatchResults([])
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not match contact')
    } finally {
      setBusy(null)
    }
  }

  async function patch(id: string, changes: Record<string, unknown>) {
    const response = await fetch('/api/marketing/recent-sales', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ id, ...changes }),
    })
    const result = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(result.error || 'Could not update opportunity')
    setSales(rows => rows.map(row => row.id === id ? result.sale : row))
    return result.sale as SaleSignal
  }

  async function approve() {
    if (!active) return
    setBusy('approve')
    try {
      await patch(active.id, { status: 'ready', suggested_message: draft })
      setNotice('Reviewed and ready to send.')
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not approve')
    } finally {
      setBusy(null)
    }
  }

  async function sendNow() {
    if (!active?.contact_id) {
      setNotice('Match this Realtor to a partnership contact before sending.')
      return
    }
    if (active.relationship_tier === 'cold' || active.relationship_tier === 'unmatched') {
      setNotice('This Realtor has no established relationship context. Open the partnership conversation and complete the normal introduction first.')
      return
    }
    setBusy('send')
    try {
      await patch(active.id, { status: 'ready', suggested_message: draft })
      const response = await fetch(`/api/marketing/contacts/${encodeURIComponent(active.contact_id)}/send-reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ body: draft }),
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(result.error || 'Message could not be sent')
      await patch(active.id, { status: 'sent' })
      setNotice('Message sent and recorded in the partnership conversation.')
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Message could not be sent')
    } finally {
      setBusy(null)
    }
  }

  async function schedule() {
    if (!active?.contact_id || !scheduleAt) {
      setNotice('Choose a matched contact and schedule time.')
      return
    }
    if (active.relationship_tier === 'cold' || active.relationship_tier === 'unmatched') {
      setNotice('This Realtor has no established relationship context. Complete the normal partnership introduction before scheduling a sale message.')
      return
    }
    setBusy('schedule')
    try {
      await patch(active.id, { status: 'ready', suggested_message: draft })
      const response = await fetch(`/api/marketing/contacts/${encodeURIComponent(active.contact_id)}/schedule-reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ body: draft, scheduled_at: new Date(scheduleAt).toISOString() }),
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(result.error || 'Message could not be scheduled')
      await patch(active.id, { status: 'scheduled' })
      setNotice('Message scheduled through the existing partnership queue.')
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Message could not be scheduled')
    } finally {
      setBusy(null)
    }
  }

  async function dismiss() {
    if (!active) return
    setBusy('dismiss')
    try {
      await patch(active.id, { status: 'dismissed', dismissal_reason: 'Not useful for relationship outreach' })
      setNotice('Opportunity dismissed.')
    } finally {
      setBusy(null)
    }
  }

  const counts = {
    review: sales.filter(s => s.status === 'needs_review').length,
    match: sales.filter(s => s.status === 'needs_match').length,
    ready: sales.filter(s => s.status === 'ready').length,
  }
  const activeContactSales = active?.contact_id
    ? sales.filter(sale => sale.contact_id === active.contact_id && sale.status !== 'dismissed')
    : []

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden border border-[var(--app-line)] bg-white">
      <aside className="flex w-[390px] min-w-[320px] flex-col border-r border-[var(--app-line)]">
        <div className="border-b border-[var(--app-line)] p-5">
          <h1 className="text-[22px] font-semibold tracking-tight text-[#111827]">Recent sales</h1>
          <p className="mt-1 text-sm text-slate-500">Verified moments worth a thoughtful partner touch.</p>
          <div className="mt-4 grid grid-cols-3 gap-2 text-center">
            <div className="rounded-lg bg-amber-50 px-2 py-2"><b>{counts.review}</b><span className="block text-[11px] text-amber-800">Review</span></div>
            <div className="rounded-lg bg-slate-100 px-2 py-2"><b>{counts.match}</b><span className="block text-[11px] text-slate-600">Match</span></div>
            <div className="rounded-lg bg-emerald-50 px-2 py-2"><b>{counts.ready}</b><span className="block text-[11px] text-emerald-700">Ready</span></div>
          </div>
          <div className="relative mt-4">
            <Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
            <input value={query} onChange={event => setQuery(event.target.value)} className="w-full rounded-lg border border-slate-200 py-2.5 pl-9 pr-3 text-[15px] outline-none focus:border-[#14213d]" placeholder="Search Realtor, brokerage, address" />
          </div>
          <select value={status} onChange={event => setStatus(event.target.value)} className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
            <option value="open">Open opportunities</option>
            <option value="needs_review">Needs review</option>
            <option value="needs_match">Needs match</option>
            <option value="ready">Ready</option>
            <option value="scheduled">Scheduled</option>
            <option value="sent">Sent</option>
            <option value="dismissed">Dismissed</option>
            <option value="all">All</option>
          </select>
          <select value={saleAge} onChange={event => setSaleAge(event.target.value as typeof saleAge)} className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
            <option value="all">All sale dates</option>
            <option value="7">Sold in the last 7 days</option>
            <option value="30">Sold in the last 30 days</option>
            <option value="older30">Older than 30 days</option>
          </select>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {loading && <div className="p-8 text-center text-sm text-slate-400">Loading verified sales…</div>}
          {!loading && visible.length === 0 && <div className="p-8 text-center text-sm text-slate-400">No opportunities in this view.</div>}
          {visible.map(sale => (
            <button key={sale.id} onClick={() => setActiveId(sale.id)} className={`block w-full border-b border-slate-100 p-4 text-left transition ${active?.id === sale.id ? 'bg-[#f4f7fb]' : 'hover:bg-slate-50'}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate font-semibold text-[#111827]">{sale.realtor_name}</div>
                  <div className="truncate text-xs text-slate-500">{sale.realtor_brokerage || 'Brokerage unavailable'}</div>
                </div>
                <span className="shrink-0 rounded-full bg-slate-100 px-2 py-1 text-[10px] font-semibold text-slate-600">{saleStatusLabel(sale)}</span>
              </div>
              <div className="mt-2 truncate text-sm text-slate-700">{sale.address}</div>
              <div className="mt-2 flex items-center justify-between text-xs text-slate-400">
                <span>{sale.city || 'Unknown city'}</span>
                <span>{dateLabel(sale.sold_verified_at)}</span>
              </div>
            </button>
          ))}
        </div>
      </aside>

      <main className="min-w-0 flex-1 overflow-y-auto">
        {!active ? (
          <div className="flex h-full items-center justify-center text-sm text-slate-400">Select a verified sale.</div>
        ) : (
          <div className="mx-auto max-w-4xl p-7">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-2xl font-semibold text-[#111827]">{active.realtor_name}</h2>
                  <span className="rounded-full bg-[#14213d] px-2.5 py-1 text-xs font-medium text-white">{active.relationship_tier.replace('_', ' ')}</span>
                </div>
                <p className="mt-1 text-sm text-slate-500">{active.realtor_brokerage || 'Brokerage unavailable'} · {active.realtor_role || 'listing agent'}</p>
                {activeContactSales.length > 1 && (
                  <p className="mt-1 text-xs font-medium text-amber-800">{activeContactSales.length} verified sales are attached to this same relationship.</p>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {active.contact_id && (
                  <button
                    onClick={() => router.push(`/marketing/partners?tab=phone&contact=${encodeURIComponent(active.contact_id || '')}&recent_sale=1`)}
                    className="inline-flex items-center gap-2 rounded-lg bg-[#071421] px-4 py-2 text-sm font-semibold text-white"
                  >
                    <MessageSquareText className="h-4 w-4" /> Review full conversation
                  </button>
                )}
                <button onClick={() => void dismiss()} disabled={busy !== null} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50">
                  <X className="h-4 w-4" /> Dismiss
                </button>
              </div>
            </div>

            <section className="mt-6 grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-slate-200 p-4">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-400"><MapPin className="h-4 w-4" /> Verified sale</div>
                <div className="mt-2 font-semibold text-[#111827]">{active.address}</div>
                <div className="mt-1 text-sm text-slate-500">{active.city}{active.mls_id ? ` · MLS ${active.mls_id}` : ''}</div>
              </div>
              <div className="rounded-xl border border-slate-200 p-4">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Evidence</div>
                <div className="mt-2 font-semibold text-[#111827]">{active.verification_confidence ?? 100}% confidence</div>
                <div className="mt-1 truncate text-sm text-slate-500">{active.verification_source || 'Verified source'}</div>
              </div>
            </section>

            {active.status === 'needs_match' && (
              <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                <div className="font-semibold">{active.realtor_name === 'Realtor not identified' ? 'Find the listing Realtor' : 'Confirm the partnership contact'}</div>
                <p className="mt-1">{active.realtor_name === 'Realtor not identified' ? 'The sold property is verified, but its listing Realtor still needs to be identified and connected.' : 'The Realtor was identified, but the system did not find a safe automatic match. Nothing can send until you select the correct record.'}</p>
                <div className="mt-3 flex gap-2">
                  <input
                    value={matchQuery}
                    onChange={event => setMatchQuery(event.target.value)}
                    onKeyDown={event => { if (event.key === 'Enter') void searchContacts() }}
                    className="min-w-0 flex-1 rounded-lg border border-amber-300 bg-white px-3 py-2 text-[15px] text-slate-900 outline-none"
                    placeholder="Search name, brokerage, or city"
                  />
                  <button onClick={() => void searchContacts()} disabled={matching} className="rounded-lg bg-amber-900 px-4 py-2 font-semibold text-white">
                    {matching ? 'Searching…' : 'Search'}
                  </button>
                </div>
                {matchResults.length > 0 && (
                  <div className="mt-2 max-h-56 overflow-y-auto rounded-lg border border-amber-200 bg-white">
                    {matchResults.map(contact => (
                      <button key={contact.id} onClick={() => void linkContact(contact)} className="flex w-full items-center justify-between gap-3 border-b border-slate-100 px-3 py-2.5 text-left last:border-0 hover:bg-slate-50">
                        <span>
                          <b className="block text-slate-900">{contact.name}</b>
                          <span className="text-xs text-slate-500">{contact.company || 'No brokerage'} · {contact.city || 'No city'}</span>
                        </span>
                        <span className="text-xs font-semibold text-amber-800">Use contact</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            <section className="mt-6 rounded-xl border border-slate-200">
              <div className="flex items-center gap-2 border-b border-slate-200 px-5 py-4">
                <MessageSquareText className="h-5 w-5 text-[#14213d]" />
                <div>
                  <h3 className="font-semibold text-[#111827]">Relationship message</h3>
                  <p className="text-xs text-slate-500">Use only after reviewing the established partnership conversation. Nothing is sent automatically.</p>
                </div>
              </div>
              <div className="p-5">
                <textarea value={draft} onChange={event => setDraft(event.target.value)} className="min-h-40 w-full resize-y rounded-xl border border-slate-200 p-4 text-[16px] leading-7 text-[#111827] outline-none focus:border-[#14213d]" />
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <button onClick={() => void approve()} disabled={busy !== null || !active.contact_id} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold text-[#14213d] disabled:opacity-40">
                    <Check className="h-4 w-4" /> {busy === 'approve' ? 'Saving…' : 'Save relationship draft'}
                  </button>
                  {active.contact_id && (
                    <button
                      onClick={() => router.push(`/marketing/partners?tab=phone&contact=${encodeURIComponent(active.contact_id || '')}&recent_sale=1`)}
                      className="inline-flex items-center gap-2 rounded-lg bg-[#071421] px-4 py-2.5 text-sm font-semibold text-white"
                    >
                      <MessageSquareText className="h-4 w-4" /> Continue in conversation
                    </button>
                  )}
                </div>
                {notice && <div className="mt-3 rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-700">{notice}</div>}
              </div>
            </section>
          </div>
        )}
      </main>
    </div>
  )
}
