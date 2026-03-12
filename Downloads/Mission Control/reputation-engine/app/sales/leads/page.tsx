'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { fetchSalesOverview } from '@/lib/sales-api'
import { formatDate } from '@/lib/sales'
import type { CRMLead } from '@/lib/types'

export default function SalesLeadsIndexPage() {
  const [leads, setLeads] = useState<CRMLead[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  async function refresh() {
    try {
      setLoading(true)
      const data = await fetchSalesOverview()
      setLeads(data.leads)
      setError(null)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  const sorted = useMemo(
    () => [...leads].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [leads]
  )

  return (
    <div className="crm-shell space-y-8">
      <section className="flex items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-[28px] font-semibold tracking-tight text-[var(--app-ink)]">Leads</h1>
          <div className="mt-2 text-sm text-[var(--app-muted)]">{leads.length} leads in the CRM right now.</div>
        </div>
        <button onClick={() => void refresh()} className="crm-button">Refresh</button>
      </section>

      {error ? <div className="rounded-[8px] border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-700">{error}</div> : null}

      {loading ? (
        <div className="rounded-[8px] border border-[var(--app-line)] bg-[var(--app-panel)] px-5 py-16 text-center text-sm text-[var(--app-muted)]">Loading leads...</div>
      ) : (
        <div className="rounded-[8px] border border-[var(--app-line)] bg-[var(--app-panel)]">
          <div className="grid grid-cols-[minmax(0,1.2fr)_150px_170px_180px] gap-4 border-b border-[var(--app-line)] px-5 py-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--app-muted)]">
            <div>Lead</div>
            <div>Stage</div>
            <div>Move</div>
            <div>Follow-Up</div>
          </div>
          <div>
            {sorted.map(lead => (
              <Link
                key={lead.id}
                href={`/sales/leads/${lead.id}`}
                className="grid grid-cols-[minmax(0,1.2fr)_150px_170px_180px] gap-4 border-b border-[var(--app-line)] px-5 py-4 text-sm transition hover:bg-[var(--app-bg)]"
              >
                <div>
                  <div className="font-medium text-[var(--app-ink)]">{lead.name}</div>
                  <div className="mt-1 text-xs text-[var(--app-muted)]">{lead.originCity || 'Origin TBD'} → {lead.destCity || 'Destination TBD'}</div>
                </div>
                <div className="text-[var(--app-ink)] capitalize">{lead.stage}</div>
                <div className="text-[var(--app-muted)]">{lead.moveDate ? formatDate(lead.moveDate) : 'Date TBD'}</div>
                <div className="text-[var(--app-muted)]">{lead.followUpDate ? formatDate(lead.followUpDate) : 'None set'}</div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
