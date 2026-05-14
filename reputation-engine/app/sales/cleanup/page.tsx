'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

interface Candidate {
  id: string
  name: string
  phone: string | null
  email: string | null
  source: string
  stage: string
  createdAt?: string
  reasons: string[]
}

const SOURCE_LABELS: Record<string, string> = {
  twilio_sms: 'Twilio SMS',
  twilio_call: 'Twilio Call',
  website_form: 'Website',
  facebook: 'Facebook',
  zapier: 'Zapier',
  other: 'Other',
  unknown: 'Unknown',
}

export default function CleanupPage() {
  const router = useRouter()
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [deleting, setDeleting] = useState(false)
  const [done, setDone] = useState<{ deleted: number; failed: number } | null>(null)

  useEffect(() => {
    fetch('/api/sales/leads/cleanup-candidates', { credentials: 'include' })
      .then(r => r.json())
      .then(d => setCandidates(d.candidates || []))
      .catch(() => null)
      .finally(() => setLoading(false))
  }, [])

  function toggleAll() {
    if (selected.size === candidates.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(candidates.map(c => c.id)))
    }
  }

  function toggle(id: string) {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelected(next)
  }

  async function deleteSelected() {
    if (selected.size === 0) return
    if (!window.confirm(`Permanently delete ${selected.size} lead${selected.size > 1 ? 's' : ''}? This cannot be undone.`)) return

    setDeleting(true)
    try {
      const res = await fetch('/api/sales/leads/cleanup-candidates', {
        method: 'DELETE',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: Array.from(selected) }),
      })
      const result = await res.json()
      setDone({ deleted: result.deleted, failed: result.failed })
      setCandidates(prev => prev.filter(c => !selected.has(c.id)))
      setSelected(new Set())
    } finally {
      setDeleting(false)
    }
  }

  const allSelected = candidates.length > 0 && selected.size === candidates.length

  return (
    <div className="mx-auto max-w-4xl p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#1a2744]">Lead Cleanup</h1>
          <p className="text-sm text-slate-500 mt-1">
            Review and delete junk leads — unknown callers, no contact info, stale records.
            <strong> You choose what goes.</strong>
          </p>
        </div>
        <button
          onClick={() => router.push('/sales')}
          className="text-sm text-slate-500 hover:text-slate-700"
        >
          ← Back to CRM
        </button>
      </div>

      {done && (
        <div className="rounded-xl bg-green-50 border border-green-200 px-5 py-4 text-green-800 text-sm">
          ✅ Deleted {done.deleted} lead{done.deleted !== 1 ? 's' : ''}.
          {done.failed > 0 && ` ${done.failed} failed.`}
        </div>
      )}

      {loading ? (
        <div className="text-slate-400 text-sm py-8 text-center">Scanning leads…</div>
      ) : candidates.length === 0 ? (
        <div className="rounded-2xl bg-slate-50 border border-slate-200 p-10 text-center text-slate-500">
          <div className="text-3xl mb-2">✨</div>
          <div className="font-medium">Nothing to clean up</div>
          <div className="text-sm mt-1">No junk leads found.</div>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between bg-white border border-slate-200 rounded-xl px-5 py-3 shadow-sm">
            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={toggleAll}
                className="h-4 w-4 rounded border-slate-300 accent-[#1a2744] cursor-pointer"
              />
              <span className="text-sm text-slate-600">
                {selected.size > 0
                  ? `${selected.size} of ${candidates.length} selected`
                  : `${candidates.length} candidate${candidates.length !== 1 ? 's' : ''} found`}
              </span>
            </div>
            <button
              onClick={deleteSelected}
              disabled={selected.size === 0 || deleting}
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40 hover:bg-red-700 transition-colors"
            >
              {deleting ? 'Deleting…' : `Delete ${selected.size > 0 ? selected.size : ''} Selected`}
            </button>
          </div>

          <div className="space-y-2">
            {candidates.map(c => (
              <label
                key={c.id}
                className={`flex items-start gap-4 rounded-xl border px-5 py-4 cursor-pointer transition-colors ${
                  selected.has(c.id)
                    ? 'border-red-300 bg-red-50'
                    : 'border-slate-200 bg-white hover:border-slate-300'
                }`}
              >
                <input
                  type="checkbox"
                  checked={selected.has(c.id)}
                  onChange={() => toggle(c.id)}
                  className="mt-0.5 h-4 w-4 rounded border-slate-300 accent-[#1a2744] cursor-pointer flex-shrink-0"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-[#1a2744] text-sm">{c.name}</span>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-500 uppercase tracking-wide">
                      {SOURCE_LABELS[c.source] || c.source}
                    </span>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-500 uppercase tracking-wide">
                      {c.stage}
                    </span>
                  </div>
                  <div className="text-xs text-slate-400 mt-0.5">
                    {c.phone || c.email || 'No contact info'}
                    {c.createdAt && ` · Added ${new Date(c.createdAt).toLocaleDateString()}`}
                  </div>
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {c.reasons.map(r => (
                      <span key={r} className="rounded-full bg-amber-100 text-amber-700 px-2 py-0.5 text-[10px] font-medium">
                        {r}
                      </span>
                    ))}
                  </div>
                </div>
              </label>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
