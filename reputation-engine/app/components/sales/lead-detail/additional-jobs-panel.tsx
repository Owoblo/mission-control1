'use client'

import Link from 'next/link'
import { LinkedLogisticsPanel } from './linked-logistics-panel'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { fetchWithReadDeadline } from '@/lib/resilient-read'
import type { CRMLead } from '@/lib/types'

type Job = { id: string; label: string; kind: string; stage: string }
export function AdditionalJobsPanel({ lead, canEdit }: { lead: CRMLead; canEdit: boolean }) {
  const router = useRouter()
  const [jobs, setJobs] = useState<Job[]>([])
  const [open, setOpen] = useState(false)
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const requestId = useRef('')
  const endpoint = `/api/sales/leads/${encodeURIComponent(lead.id)}/additional-jobs`
  const load = useCallback(async () => {
    setReady(false)
    try {
      const response = await fetchWithReadDeadline(endpoint, { cache: 'no-store' })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Could not load additional jobs.')
      setJobs(data.jobs); setReady(true); setError('')
    } catch (err) { setError((err as Error).message) }
  }, [endpoint])
  useEffect(() => { void load() }, [load])
  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    if (!requestId.current) requestId.current = crypto.randomUUID()
    setBusy(true); setError('')
    try {
      const response = await fetch(endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(25000),
        body: JSON.stringify({ ...Object.fromEntries(form), requestId: requestId.current }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Could not create additional job.')
      router.push(`/sales/leads/${data.lead.id}`)
    } catch (err) {
      setError(`${(err as Error).message} Your entries are still here. Retry this form to recover the same job.`)
      setBusy(false)
    }
  }
  return <div className="rounded-lg border border-[var(--app-line)] bg-[var(--app-bg)] p-3 space-y-3">
    <div className="text-sm font-semibold">Additional work</div>
    <p className="text-xs text-[var(--app-muted)]">Create a linked quote with its own inventory, price and customer approval. The original booking and deposit stay unchanged.</p>
    {jobs.map(job => <Link key={job.id} href={`/sales/leads/${job.id}`} className="block rounded border bg-white p-2 text-sm hover:underline">{job.label} <span className="block text-xs text-[var(--app-muted)]">{job.kind === 'supplement' ? 'Same move · additional scope' : 'Separate booking'} · {job.stage}</span></Link>)}
    <LinkedLogisticsPanel leadId={lead.id} jobs={jobs} />
    {error && <div role="alert" className="text-xs text-red-700">{error} {!ready && <button className="underline" onClick={() => void load()}>Reload linked jobs</button>}</div>}
    {!open ? <button className="crm-button w-full justify-center disabled:opacity-50" disabled={!canEdit || !ready} onClick={() => setOpen(true)}>+ Add additional quote</button> : <form onSubmit={create} className="space-y-3">
      <label className="block text-xs">How does this work relate to the booking?<select name="kind" className="crm-input w-full" defaultValue="supplement"><option value="supplement">Same move · additional scope</option><option value="separate">Separate booking</option></select></label>
      <label className="block text-xs">Job label<input name="label" required maxLength={100} placeholder="Storage pickup" className="crm-input w-full" /></label>
      <label className="block text-xs">Additional work requested<textarea name="scope" required maxLength={4000} placeholder="Customer request; contents and access still to confirm" className="crm-input w-full" /></label>
      <label className="block text-xs">Pickup address<input name="originAddress" maxLength={500} className="crm-input w-full" placeholder="Confirm the storage address" /></label>
      <label className="block text-xs">Delivery address<input name="destAddress" maxLength={500} className="crm-input w-full" placeholder="Leave blank if unconfirmed" /></label>
      <label className="block text-xs">Date, if confirmed<input name="moveDate" type="date" className="crm-input w-full" /></label>
      <p className="text-xs text-[var(--app-muted)]">This creates a draft job file. Review its inventory and access before building and sending a quote. For the same move, review the combined load and crew plan on the original booking after acceptance.</p>
      <button type="submit" disabled={busy} className="crm-button w-full justify-center disabled:opacity-50">{busy ? 'Creating draft…' : 'Create additional draft'}</button>
      <button type="button" disabled={busy} onClick={() => setOpen(false)} className="text-xs underline">Close</button>
    </form>}
  </div>
}
